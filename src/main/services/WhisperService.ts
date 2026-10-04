import { spawn, spawnSync, ChildProcess } from 'child_process'
import { join, dirname, basename } from 'path'
import { openSync, readSync, closeSync, unlinkSync, existsSync, readFileSync, writeFileSync, statSync } from 'fs'
import { StringDecoder } from 'string_decoder'
import { tmpdir, cpus, totalmem, release } from 'os'
import { randomUUID } from 'crypto'
import { parseSRT, type CaptionEntry } from '../../shared/utils/srt'
import { stripBOM } from '../../shared/utils/encoding'
import { appendCappedText, formatStderrMessage } from '../../shared/export/ffmpegText'
import type { FFmpegService } from './FFmpegService'

/**
 * Cap on retained whisper stderr per transcription (Phase 8/9). The log is
 * only used for progress regex + failure tail; transcript text comes from
 * the SRT/JSON sidecar files, so capping loses nothing.
 */
const MAX_WHISPER_STDERR = 64 * 1024

/** Discriminated failure modes for model validation */
export type ValidationErrorType = 'crash' | 'timeout' | 'not_found' | 'startup_failed' | 'unknown'

/** Structured result from a single model validation run */
export interface ValidationResult {
  ok: boolean
  exitCode: number | null
  error?: string
  errorType?: ValidationErrorType
}

export interface ModelCompatibilityInfo {
  /** Currently active model file name */
  activeModel: string
  /** Whether the primary (requested) model passed validation */
  primaryOk: boolean
  /** Which fallback step was selected (0 = primary, 1 = first fallback, etc.) */
  fallbackLevel: number
  /** Models that were tried and their validation results */
  triedModels: Array<{ file: string; ok: boolean; exitCode: number | null; error?: string; errorType?: ValidationErrorType }>
}

export interface DiagnosticsResult {
  binary: boolean
  binaryPath: string
  model: boolean
  modelPath: string
  cpuAVX2: boolean
  cpuAVX: boolean
  cpuFMA: boolean
  cpuSSE41: boolean
  cpuSSE42: boolean
  cpuName: string
  vcRuntime: boolean
  ramTotalMB: number
  osVersion: string
  whisperVersion: string
  /** Results of the live diagnostic tests (binary, model, audio) */
  tests?: DiagnosticTests
  /** Model fallback/compatibility info */
  modelCompatibility?: ModelCompatibilityInfo
}

export interface DiagnosticTests {
  binaryHelp:   ValidationResult
  modelLoad:    ValidationResult
  audioProcess: ValidationResult & { output?: string }
}

/**
 * WhisperService — Direct spawn of whisper-cli.exe (no worker_threads needed;
 * spawn() is already non-blocking).  Eliminates the dead worker-file path
 * problem where rollup could not trace dynamic new Worker() calls.
 *
 * Features:
 *   - Persistent disk cache (userData/whisper-cache.json) skips validation
 *     when model+binary haven't changed across app launches.
 *   - Lightweight smoke test (whisper-cli directly, not whisper-bench)
 *   - Streaming pipeline: FFmpeg stdout → whisper stdin (no temp WAV)
 *   - Automatic fallback: streaming → file-based on failure
 *   - Full telemetry for pipeline diagnostics
 */
export interface TranscriptionResult {
  entries: Array<{
    id: string
    startMs: number
    endMs: number
    text: string
    words?: Array<{ word: string; startMs: number; endMs: number }>
    wordTimestampsSource?: 'whisper' | 'synthetic'
  }>
  language: string
  /** Telemetry from the transcription run (for diagnostics) */
  telemetry?: TranscriptionTelemetry
}

/** Full diagnostic telemetry for transcription pipeline auditing */
export interface TranscriptionTelemetry {
  mediaDurationMs: number
  extractionDurationMs: number
  modelLoadDurationMs: number
  inferenceDurationMs: number
  parseDurationMs: number
  totalDurationMs: number
  captionCount: number
  wordCount: number
  ffmpegExitCode: number | null
  whisperExitCode: number | null
  stdoutLength: number
  stderrLength: number
  mode: 'streaming' | 'file' | 'streaming-fallback-file'
  bytesStreamed?: number
  bytesReceived?: number
  /** Raw stderr content for diagnostic logging */
  stderrText?: string
  /** Drift analysis: synthetic vs whisper word timestamps (ms). Only populated when JSON tokens exist. */
  wordTimingDriftMs?: { min: number; max: number; mean: number; count: number }
}

export interface TranscriptionOptions {
  audioPath: string
  language?: string
  modelPath?: string
  wordTimestamps?: boolean
  onProgress?: (percent: number) => void
  /** Called when the transcription enters a new phase (for UI status) */
  onPhase?: (phase: 'extracting-audio' | 'loading-model' | 'transcribing' | 'done') => void
  /** Trim offsets for clip-level transcription (respects timeline trim) */
  trimStartMs?: number
  trimEndMs?: number
  /** Total duration of the source media (used for trim-aware extraction) */
  sourceDurationMs?: number
}

export class WhisperService {
  private activeProcess: ChildProcess | null = null
  /** Active FFmpeg process for the streaming pipeline — killed on retry */
  private activeFfmpegProcess: ChildProcess | null = null
  /**
   * FFmpeg extraction process spawned by the IPC handler BEFORE transcribe().
   * Set by the handler so cancel() can kill it during the extraction phase
   * (when WhisperService has no active whisper/ffmpeg process yet).
   */
  public activeExtractionProcess: ChildProcess | null = null
  /** The model path currently in use (may differ from constructor arg if fallback was needed) */
  private activeModelPath: string
  /**
   * Session-level resolve cache — once a model is successfully resolved,
   * subsequent calls to resolveModelPathAsync() return the cached path
   * without re-running the fallback chain.  Only invalidated by an explicit
   * call to invalidateModelCache() (e.g. when the user changes models).
   * This eliminates redundant "Model resolved" logs and spawn overhead
   * across multiple transcribe() invocations.
   */
  private _resolvedModelPathCache: string | null = null
  /** Set to true after startup validation completes — gates checkEnvironment() in transcribe() */
  private _startupValidated = false
  /** Optional FFmpegService for audio pre-processing (video → 16kHz mono WAV) */
  private ffmpeg: FFmpegService | null = null

  /**
   * In-memory validation cache — prevents re-spawning whisper-cli for models
   * that already crashed (e.g. q5_1 kernel bug) within the same session.
   * Key: "cliPath:modelFileName", Value: ValidationResult.
   * This avoids paying the crash-and-fallback cost on every transcription.
   */
  private static validationCache = new Map<string, ValidationResult>()

  /** Persistent disk cache — survives app restarts */
  private static readonly CACHE_FILENAME = 'whisper-cache.json'

  private static getCachePath(): string {
    const { app } = require('electron')
    return join(app.getPath('userData'), WhisperService.CACHE_FILENAME)
  }

  private static loadPersistentCache(): { modelFile: string; modelHash: string; whisperVersion: string; appVersion: string; validated: boolean; lastSuccess: number } | null {
    try {
      const cachePath = WhisperService.getCachePath()
      if (!existsSync(cachePath)) return null
      return JSON.parse(stripBOM(readFileSync(cachePath, 'utf-8')))
    } catch { return null }
  }

  private static savePersistentCache(entry: { modelFile: string; modelHash: string; whisperVersion: string; appVersion: string; validated: boolean; lastSuccess: number }): void {
    try { writeFileSync(WhisperService.getCachePath(), JSON.stringify(entry, null, 2), 'utf-8') }
    catch (e) { console.warn('[WhisperService] Failed to save persistent cache:', (e as Error).message) }
  }

  private static hashFile(path: string): string {
    try { const s = statSync(path); return `${s.size}:${s.mtimeMs.toFixed(0)}` }
    catch { return 'unknown' }
  }

  static isPersistentCacheValid(_cliPath: string, modelPath: string, appVersion: string): boolean {
    const cache = WhisperService.loadPersistentCache()
    if (!cache || !cache.validated) return false
    if (cache.modelHash !== WhisperService.hashFile(modelPath)) return false
    if (cache.appVersion !== appVersion) return false
    console.log('[WhisperService] Persistent cache VALID — skipping validation')
    return true
  }

  /**
   * Fallback model chain — tried after the constructor-provided primary model
   * when the current model is incompatible.
   * All models must be GGML format (whisper.cpp v1.8.x does not support GGUF).
   *
   * Order rationale (q5_1 REMOVED — known kernel bug in v1.8.6 ggml-cpu.dll):
   *   - primary constructor model first (app default: ggml-small-q8_0.bin)
   *   - ggml-base-q8_0.bin  — fast quantized fallback
   *   - ggml-base.bin       — unquantized base fallback
   *   - ggml-small-q8_0.bin — quantized small fallback
   *   - ggml-small.bin      — unquantized small fallback
   */
  private static readonly FALLBACK_MODELS = [
    'ggml-base-q8_0.bin',
    'ggml-base.bin',
    'ggml-small-q8_0.bin',
    'ggml-small.bin'
  ]

  /** Results from the most recent model validation (startup or diagnostic) */
  private lastValidation: ModelCompatibilityInfo | null = null

  constructor(private modelPath: string, ffmpeg?: FFmpegService) {
    this.activeModelPath = modelPath
    this.ffmpeg = ffmpeg ?? null
  }

  /** Resolve whisper-cli binary path — selects optimal variant for CPU */
  private resolveCliPath(): string {
    const { app } = require('electron')
    const platform = process.platform
    const isWin = platform === 'win32'

    const baseDir = app.isPackaged
      ? join(process.resourcesPath, 'bin')
      : join(app.getAppPath(), 'resources', 'bin')

    // Prefer AVX2-optimized binary if CPU supports it
    const { hasAVX2 } = this.detectCpuFeatures()
    if (hasAVX2) {
      const avx2Name = isWin ? 'whisper-cli-avx2.exe' : 'whisper-cli-avx2'
      const avx2Path = join(baseDir, avx2Name)
      if (existsSync(avx2Path)) return avx2Path
    }

    // Fallback to compat binary (without AVX2 requirements)
    const compatName = isWin ? 'whisper-cli-compat.exe' : 'whisper-cli-compat'
    const compatPath = join(baseDir, compatName)
    if (existsSync(compatPath)) return compatPath

    // Ultimate fallback: default binary
    const exeName = isWin ? 'whisper-cli.exe' : 'whisper-cli'
    return join(baseDir, exeName)
  }

  /** Transcribe audio file — spawns whisper-cli directly.
   *  When FFmpegService is available and input is video, uses streaming:
   *  FFmpeg stdout → whisper stdin, eliminating temp WAV files.
   *  On streaming failure or empty result, automatically falls back
   *  to file-based transcription for reliability. */
  async transcribe(options: TranscriptionOptions): Promise<TranscriptionResult> {
    const tStart = Date.now()
    console.log(`[WhisperService] transcribe() started — audioPath=${options.audioPath}${options.trimStartMs !== undefined ? ` trim=${options.trimStartMs}ms` : ''}`)

    // Fast path: trust startup validation.
    // Cache is NEVER invalidated on normal calls — only on explicit reset or crash.
    if (!this._startupValidated) {
      console.log('[WhisperService] First call — running checkEnvironment()')
      const envCheck = await this.checkEnvironment()
      if (!envCheck.ok) throw new Error(`ENV_CHECK_FAILED: ${envCheck.reason}`)
      if (envCheck.warning) console.warn(`[WhisperService] checkEnvironment warning: ${envCheck.warning}`)
      this._startupValidated = true
    }

    // Kill any previous transcription on retry
    this.killActiveProcesses()

    const videoExtensions = /.(mp4|mov|avi|mkv|webm|m4v|flv|ts)$/i
    const isVideo = videoExtensions.test(options.audioPath)
    const modelPath = options.modelPath || this.activeModelPath
    const cliPath = this.resolveCliPath()
    console.log(`[WhisperService] Model: ${basename(modelPath)}, CLI: ${basename(cliPath)}`)

    // ---- Attempt A: Streaming pipeline (FFmpeg stdout → whisper stdin) ----
    if (isVideo && this.ffmpeg) {
      try {
        const result = await this.transcribeStreaming(cliPath, modelPath, options, tStart)
        // Sanity check: long media with zero captions is suspicious
        if (result.entries.length === 0 && result.telemetry && result.telemetry.mediaDurationMs > 15000) {
          console.warn('[WhisperService] Streaming produced 0 captions on >15s media — falling back to file mode')
          // Fall through to file-based attempt
        } else {
          return result
        }
      } catch (err) {
        console.warn(`[WhisperService] Streaming failed: ${(err as Error).message} — falling back to file mode`)
        // Invalidate cache on genuine failure so retry gets fresh resolution
        this.invalidateModelCache()
        // Clean up any zombie processes from the failed attempt
        this.killActiveProcesses()
      }
    }

    // ---- Attempt B: Legacy file-based transcription ----
    return this.transcribeFromFile(cliPath, modelPath, options, tStart, isVideo && !!this.ffmpeg)
  }
  
  /**
   * Streaming pipeline: FFmpeg decodes video to WAV on stdout,
   * piped directly to whisper-cli stdin. No temp files on disk.
   * FFmpeg exit non-zero → rejects the promise (triggers fallback).
   */
  private async transcribeStreaming(
    cliPath: string, modelPath: string,
    options: TranscriptionOptions, tStart: number
  ): Promise<TranscriptionResult> {
    const telemetry: TranscriptionTelemetry = {
      mediaDurationMs: 0, extractionDurationMs: 0, modelLoadDurationMs: 0,
      inferenceDurationMs: 0, parseDurationMs: 0, totalDurationMs: 0,
      captionCount: 0, wordCount: 0,
      ffmpegExitCode: null, whisperExitCode: null,
      stdoutLength: 0, stderrLength: 0,
      mode: 'streaming', bytesStreamed: 0
    }

    // Estimate media duration from trim options or file size
    if (options.sourceDurationMs) {
      const trimStart = options.trimStartMs || 0
      const trimEnd = options.trimEndMs || 0
      telemetry.mediaDurationMs = Math.max(0, options.sourceDurationMs - trimStart - trimEnd)
    } else {
      try {
        const fileSize = statSync(options.audioPath).size
        telemetry.mediaDurationMs = Math.round(fileSize / 16000 * 1000) // ~128kbps estimate
      } catch { /* non-critical */ }
    }

    options.onPhase?.('extracting-audio')
    if (options.onProgress) options.onProgress(2)

    const tExtractStart = Date.now()

    // Build FFmpeg args for trim-aware 16kHz mono WAV extraction to stdout
    const ffmpegArgs: string[] = []
    if (options.trimStartMs !== undefined && options.trimStartMs > 0) {
      ffmpegArgs.push('-ss', (options.trimStartMs / 1000).toString())
    }
    ffmpegArgs.push('-i', options.audioPath)
    if (options.sourceDurationMs !== undefined && options.trimEndMs !== undefined) {
      const durMs = options.sourceDurationMs - (options.trimStartMs || 0) - options.trimEndMs
      if (durMs > 0) ffmpegArgs.push('-t', (durMs / 1000).toString())
    }
    ffmpegArgs.push('-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1')

    const ffmpegBinPath = (this.ffmpeg as any).ffmpegPath as string
    const ffmpegProcess = spawn(ffmpegBinPath, ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    })
    this.activeFfmpegProcess = ffmpegProcess

    // Whisper reads from stdin ('-f -'). Output goes to a temp SRT file
    // because -osrt writes to a FILE, not stdout (confirmed via whisper-cli -h).
    const srtOutPath = join(tmpdir(), `whisper_out_${randomUUID()}`)
    const whisperArgs = [
      '-m', modelPath, '-f', '-',
      '-l', (options.language || 'auto'),
      '-t', String(Math.max(1, cpus().length - 1)),
      '-ng', '-nfa', '-pp', '-osrt', '-ojf', '-np',
      '-of', srtOutPath
    ]
    console.log(`[WhisperService] STREAMING args: ${whisperArgs.join(' ')}`)

    const tModelLoad = Date.now()
    options.onPhase?.('loading-model')
    if (options.onProgress) options.onProgress(8)

    const proc = spawn(cliPath, whisperArgs, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    })
    this.activeProcess = proc

    const tInferenceStart = Date.now()
    telemetry.modelLoadDurationMs = tInferenceStart - tModelLoad
    options.onPhase?.('transcribing')
    if (options.onProgress) options.onProgress(10)

    // Pipe FFmpeg stdout → whisper stdin
    let bytesPiped = 0
    ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
      bytesPiped += chunk.length
      telemetry.bytesStreamed = bytesPiped
    })
    ffmpegProcess.stdout.pipe(proc.stdin!)

    return new Promise<TranscriptionResult>((resolve, reject) => {
      let stderr = ''
      let stdout = ''
      let detectedLanguage = options.language || 'auto'
      let ffmpegExited = false
      let ffmpegCode: number | null = null

      // ---- FFmpeg SUPERVISION: reject if FFmpeg fails ----
      ffmpegProcess.on('close', (code) => {
        ffmpegExited = true
        ffmpegCode = code
        telemetry.ffmpegExitCode = code
        console.log(`[WhisperService] FFmpeg exited code=${code}, bytes piped=${bytesPiped}`)
        if (code !== 0) {
          proc.kill('SIGKILL')
          this.activeProcess = null
          this.activeFfmpegProcess = null
          reject(new Error(`FFmpeg audio extraction failed (exit ${code}).`))
        }
      })

      ffmpegProcess.on('error', (err) => {
        proc.kill('SIGKILL')
        this.activeProcess = null
        this.activeFfmpegProcess = null
        reject(new Error(`FFmpeg process error: ${err.message}`))
      })

      // UTF-8 policy (Phase 9): StringDecoder never splits a multi-byte
      // sequence across chunks; stderr is tail-capped (Phase 8).
      const outDecoder = new StringDecoder('utf8')
      const errDecoder = new StringDecoder('utf8')
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += outDecoder.write(chunk) })

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = errDecoder.write(chunk)
        stderr = appendCappedText(stderr, text, MAX_WHISPER_STDERR)
        const progressMatch = text.match(/progress\s*=\s*(\d+)%/)
        if (progressMatch && options.onProgress) {
          options.onProgress(Math.min(95, 10 + parseInt(progressMatch[1], 10) * 0.85))
        }
        const langMatch = text.match(/auto-detected language:\s*(\w+)/i)
        if (langMatch) detectedLanguage = langMatch[1]
      })

      proc.on('close', (code) => {
        this.activeProcess = null
        this.activeFfmpegProcess = null
        const tParse = Date.now()
        telemetry.whisperExitCode = code
        telemetry.stdoutLength = stdout.length
        telemetry.stderrLength = stderr.length
        telemetry.inferenceDurationMs = tParse - tInferenceStart
        telemetry.extractionDurationMs = ffmpegExited ? (telemetry.inferenceDurationMs) : (tParse - tExtractStart)
        telemetry.totalDurationMs = Date.now() - tStart

        console.log(
          `[WhisperService] STREAMING telemetry: mode=streaming ffmpeg=${ffmpegCode} whisper=${code}` +
          ` stdout=${stdout.length} stderr=${stderr.length} bytesPiped=${bytesPiped}` +
          ` extract=${telemetry.extractionDurationMs}ms model=${telemetry.modelLoadDurationMs}ms` +
          ` infer=${telemetry.inferenceDurationMs}ms total=${telemetry.totalDurationMs}ms`
        )
        if (stderr) {
          console.log(`[WhisperService] STREAMING STDERR (${stderr.length}B):\n${stderr.slice(-4000)}`)
          telemetry.stderrText = stderr
        }

        if (code !== 0) {
          return reject(new Error(`whisper-cli exited with code ${code}: ${formatStderrMessage(stderr)}`))
        }

        if (options.onProgress) options.onProgress(95)
        let entries: CaptionEntry[] = []
        // -osrt writes to a FILE, not stdout. Read the generated .srt file.
        const srtFilePath = srtOutPath + '.srt'
        
        // Also read JSON output for word-level token timestamps
        let jsonTokens: Array<Array<{ word: string; startMs: number; endMs: number }>> | null = null
        const jsonFilePath = srtOutPath + '.json'
        try {
          if (existsSync(jsonFilePath)) {
            const jsonContent = readFileSync(jsonFilePath, 'utf-8')
            console.log(`[WhisperService] STREAMING read JSON file: ${jsonFilePath} (${jsonContent.length}B)`)
            jsonTokens = WhisperService.parseJsonTokens(jsonContent)
            if (jsonTokens) {
              console.log(`[WhisperService] STREAMING parsed ${jsonTokens.length} segments with word tokens`)
            }
            unlinkSync(jsonFilePath)
          } else {
            console.warn(`[WhisperService] STREAMING JSON file not found: ${jsonFilePath}`)
          }
        } catch (e) {
          console.warn(`[WhisperService] STREAMING failed to read/parse JSON: ${(e as Error).message}`)
        }
        
        try {
          if (existsSync(srtFilePath)) {
            const srtContent = readFileSync(srtFilePath, 'utf-8')
            telemetry.stdoutLength = srtContent.length
            console.log(`[WhisperService] STREAMING read SRT file: ${srtFilePath} (${srtContent.length}B)`)
            console.log(`[WhisperService] STREAMING SRT RAW CONTENT:\n${srtContent || '(EMPTY)'}`)
            if (srtContent.trim()) {
              const parsed = WhisperService.parseSRTOutput(srtContent, options.wordTimestamps ?? true, jsonTokens)
              entries = parsed.entries
              telemetry.wordTimingDriftMs = parsed.driftMs
            }
            unlinkSync(srtFilePath)
          } else {
            console.warn(`[WhisperService] STREAMING SRT file not found: ${srtFilePath}`)
            telemetry.stdoutLength = stdout.length
            if (stdout.trim()) {
              const parsed = WhisperService.parseSRTOutput(stdout, options.wordTimestamps ?? true, jsonTokens)
              entries = parsed.entries
              telemetry.wordTimingDriftMs = parsed.driftMs
            }
          }
        } catch (e) {
          console.warn(`[WhisperService] STREAMING failed to read SRT file: ${(e as Error).message}`)
          telemetry.stdoutLength = stdout.length
        }
        telemetry.captionCount = entries.length
        telemetry.wordCount = entries.reduce((sum, e) => sum + (e.words?.length ?? e.text.split(/\s+/).length), 0)
        telemetry.parseDurationMs = Date.now() - tParse

        options.onPhase?.('done')
        if (options.onProgress) options.onProgress(100)
        resolve({ entries, language: detectedLanguage, telemetry })
      })

      proc.on('error', (err) => {
        this.activeProcess = null
        this.activeFfmpegProcess = null
        ffmpegProcess.kill()
        reject(new Error(`whisper-cli spawn error: ${err.message}`))
      })
    })
  }
  
  /**
   * File-based transcription for WAV/MP3 inputs (no FFmpeg needed).
   * Also used as automatic fallback when streaming fails.
   */
  private transcribeFromFile(
    cliPath: string, modelPath: string,
    options: TranscriptionOptions, tStart: number,
    isFallback = false
  ): Promise<TranscriptionResult> {
    const telemetry: TranscriptionTelemetry = {
      mediaDurationMs: 0, extractionDurationMs: 0, modelLoadDurationMs: 0,
      inferenceDurationMs: 0, parseDurationMs: 0, totalDurationMs: 0,
      captionCount: 0, wordCount: 0,
      ffmpegExitCode: null, whisperExitCode: null,
      stdoutLength: 0, stderrLength: 0,
      mode: isFallback ? 'streaming-fallback-file' : 'file'
    }

    // Estimate media duration from file size for WAV (16kHz mono 16-bit = 32000 bytes/sec)
    try {
      const fileSize = statSync(options.audioPath).size
      const wavExt = /\.wav$/i.test(options.audioPath)
      if (wavExt && fileSize > 44) {
        telemetry.mediaDurationMs = Math.round((fileSize - 44) / 32000 * 1000)
      } else {
        // Rough estimate: assume ~128kbps for compressed audio
        telemetry.mediaDurationMs = Math.round(fileSize / 16000 * 1000)
      }
    } catch { /* non-critical */ }

    const audioInputPath = options.audioPath
    options.onPhase?.('loading-model')
    if (options.onProgress) options.onProgress(8)

    const tModelLoadEnd = Date.now()
    telemetry.modelLoadDurationMs = tModelLoadEnd - tStart

    // -osrt writes to a FILE, not stdout. Use -of to control output path.
    const srtOutPath = join(tmpdir(), `whisper_file_${randomUUID()}`)
    const args = [
      '-m', modelPath, '-f', audioInputPath,
      '-l', (options.language || 'auto'),
      '-t', String(Math.max(1, cpus().length - 1)),
      '-ng', '-nfa', '-pp', '-osrt', '-ojf', '-np',
      '-of', srtOutPath
    ]
    console.log(`[WhisperService] FILE args: ${args.join(' ')}`)

    options.onPhase?.('transcribing')
    if (options.onProgress) options.onProgress(10)

    const tInferenceStart = Date.now()
    const proc = spawn(cliPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.activeProcess = proc

    return new Promise<TranscriptionResult>((resolve, reject) => {
      let stderr = ''
      let stdout = ''
      let detectedLanguage = options.language || 'auto'

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderr += text
        const progressMatch = text.match(/progress\s*=\s*(\d+)%/)
        if (progressMatch && options.onProgress) {
          options.onProgress(Math.min(95, 10 + parseInt(progressMatch[1], 10) * 0.85))
        }
        const langMatch = text.match(/auto-detected language:\s*(\w+)/i)
        if (langMatch) detectedLanguage = langMatch[1]
      })

      proc.on('close', (code) => {
        this.activeProcess = null
        const tParse = Date.now()
        telemetry.whisperExitCode = code
        telemetry.stdoutLength = stdout.length
        telemetry.stderrLength = stderr.length
        telemetry.inferenceDurationMs = tParse - tInferenceStart
        telemetry.totalDurationMs = Date.now() - tStart

        console.log(
          `[WhisperService] FILE telemetry: mode=${telemetry.mode} whisper=${code}` +
          ` stdout=${stdout.length} stderr=${stderr.length}` +
          ` model=${telemetry.modelLoadDurationMs}ms infer=${telemetry.inferenceDurationMs}ms` +
          ` total=${telemetry.totalDurationMs}ms`
        )
        if (stderr) {
          console.log(`[WhisperService] FILE STDERR (${stderr.length}B):\n${stderr.slice(-4000)}`)
          telemetry.stderrText = stderr
        }

        if (code !== 0) {
          return reject(new Error(`whisper-cli exited with code ${code}: ${formatStderrMessage(stderr)}`))
        }
        if (options.onProgress) options.onProgress(95)
        let entries: CaptionEntry[] = []
        // -osrt writes to a FILE, not stdout. Read the generated .srt file.
        const srtFilePath = srtOutPath + '.srt'
        
        // Also read JSON output for word-level token timestamps
        let jsonTokens: Array<Array<{ word: string; startMs: number; endMs: number }>> | null = null
        const jsonFilePath = srtOutPath + '.json'
        try {
          if (existsSync(jsonFilePath)) {
            const jsonContent = readFileSync(jsonFilePath, 'utf-8')
            console.log(`[WhisperService] FILE read JSON file: ${jsonFilePath} (${jsonContent.length}B)`)
            jsonTokens = WhisperService.parseJsonTokens(jsonContent)
            if (jsonTokens) {
              console.log(`[WhisperService] FILE parsed ${jsonTokens.length} segments with word tokens`)
            }
            unlinkSync(jsonFilePath)
          } else {
            console.warn(`[WhisperService] FILE JSON file not found: ${jsonFilePath}`)
          }
        } catch (e) {
          console.warn(`[WhisperService] FILE failed to read/parse JSON: ${(e as Error).message}`)
        }
        
        try {
          if (existsSync(srtFilePath)) {
            const srtContent = readFileSync(srtFilePath, 'utf-8')
            telemetry.stdoutLength = srtContent.length
            console.log(`[WhisperService] FILE read SRT file: ${srtFilePath} (${srtContent.length}B)`)
            if (srtContent.trim()) {
              const parsed = WhisperService.parseSRTOutput(srtContent, options.wordTimestamps ?? true, jsonTokens)
              entries = parsed.entries
              telemetry.wordTimingDriftMs = parsed.driftMs
            }
            unlinkSync(srtFilePath)
          } else {
            console.warn(`[WhisperService] FILE SRT file not found: ${srtFilePath}`)
            telemetry.stdoutLength = stdout.length
            if (stdout.trim()) {
              const parsed = WhisperService.parseSRTOutput(stdout, options.wordTimestamps ?? true, jsonTokens)
              entries = parsed.entries
              telemetry.wordTimingDriftMs = parsed.driftMs
            }
          }
        } catch (e) {
          console.warn(`[WhisperService] FILE failed to read SRT file: ${(e as Error).message}`)
          telemetry.stdoutLength = stdout.length
        }
        telemetry.captionCount = entries.length
        telemetry.wordCount = entries.reduce((sum, e) => sum + (e.words?.length ?? e.text.split(/\s+/).length), 0)
        telemetry.parseDurationMs = Date.now() - tParse

        options.onPhase?.('done')
        if (options.onProgress) options.onProgress(100)
        resolve({ entries, language: detectedLanguage, telemetry })
      })

      proc.on('error', (err) => {
        this.activeProcess = null
        reject(new Error(`whisper-cli spawn error: ${err.message}`))
      })
    })
  }

  /** Cancel active transcription */
  cancel(): void {
    this.killActiveProcesses()
  }

  /** Kill any running child processes (helper to avoid TS narrowing issues) */
  private killActiveProcesses(): void {
    if (this.activeProcess) { this.activeProcess.kill('SIGKILL') }
    if (this.activeFfmpegProcess) { this.activeFfmpegProcess.kill('SIGKILL') }
    if (this.activeExtractionProcess) {
      this.activeExtractionProcess.kill('SIGKILL')
      this.activeExtractionProcess = null
    }
    this.activeProcess = null
    this.activeFfmpegProcess = null
  }

  /** Check if a usable Whisper model is available (resolved via fallback chain) */
  isModelAvailable(): boolean {
    return existsSync(this.activeModelPath)
  }

  /**
   * Non-blocking spawn for model validation.  Uses child_process.spawn
   * (NOT spawnSync) so the main thread is never frozen.  Returns a
   * discriminated ValidationResult with errorType for proper handling.
   *
   * Timeout is enforced via a JS timer + proc.kill() — the 'timeout' option
   * on spawn() behaves inconsistently across platforms for crashed children.
   */
  private spawnForValidation(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<ValidationResult> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, { windowsHide: true })
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL') }, timeoutMs)

      // Discard output — we only need exit status
      proc.stdout?.resume()
      proc.stderr?.resume()

      proc.on('close', (code, signal) => {
        clearTimeout(timer)
        if (timedOut) {
          resolve({ ok: false, exitCode: null, error: 'Validation timed out', errorType: 'timeout' })
          return
        }
        if (signal) {
          resolve({ ok: false, exitCode: null, error: `Killed by signal ${signal}`, errorType: 'crash' })
          return
        }
        if (code === 0) {
          resolve({ ok: true, exitCode: 0 })
          return
        }
        // Non-zero exit — classify as crash or unknown failure
        const unsignedCode = (code ?? 0) >>> 0
        const hex = unsignedCode.toString(16).toUpperCase()
        // Known Windows crash codes
        const crashCodes = new Set([0xC0000409, 0xC0000005, 0xC000001D, 0xC0000135])
        const errorType: ValidationErrorType = crashCodes.has(unsignedCode) ? 'crash' : 'unknown'
        resolve({
          ok: false,
          exitCode: code,
          error: `Exit code ${code} (0x${hex})`,
          errorType
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        resolve({ ok: false, exitCode: null, error: err.message, errorType: 'startup_failed' })
      })
    })
  }

  /**
   * Read GGML model header to verify format without spawning a process.
   * Returns { valid, ftype, version } or { valid: false, error }.
   *
   * GGML magic: "ggml" in little-endian → bytes 0x67 0x67 0x6D 0x6C
   * GGUF magic: "GGUF" → bytes 0x47 0x47 0x55 0x46
   *
   * This is an instant file-read — suitable for startup validation
   * without blocking the main thread.
   */
  private readGgmlHeader(modelPath: string): { valid: boolean; error?: string; ftype?: number; version?: number } {
    if (!existsSync(modelPath)) {
      return { valid: false, error: 'File not found' }
    }
    let fd: number | undefined
    try {
      fd = openSync(modelPath, 'r')
      const magic = Buffer.alloc(4)
      readSync(fd, magic, 0, 4, 0)
      const magicStr = magic.toString('utf8')
      if (magicStr === 'GGUF') {
        return { valid: false, error: 'GGUF format — not supported by whisper.cpp v1.8.x (requires GGML)' }
      }
      if (magicStr !== 'ggml') {
        // Double-check via raw bytes: ggml = 0x67676D6C in LE
        if (magic[0] !== 0x67 || magic[1] !== 0x67 || magic[2] !== 0x6D || magic[3] !== 0x6C) {
          return { valid: false, error: `Unknown model format (magic: 0x${magic.toString('hex')})` }
        }
      }
      // Read version (uint32 at offset 4)
      const verBuf = Buffer.alloc(4)
      readSync(fd, verBuf, 0, 4, 4)
      const version = verBuf.readUInt32LE(0)

      // Read ftype (uint32 — offset depends on version, but for v1 it's at offset 16)
      // GGML v1 header: magic(4) + version(4) + n_vocab(4) + n_embd(4) + ... + ftype(4 at offset ~16)
      const ftypeBuf = Buffer.alloc(4)
      readSync(fd, ftypeBuf, 0, 4, 16)
      const ftype = ftypeBuf.readUInt32LE(0)

      return { valid: true, ftype, version }
    } catch (e) {
      return { valid: false, error: `Failed to read model header: ${(e as Error).message}` }
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd) } catch { /* ignore */ }
      }
    }
  }

  /**
   * Lightweight model validation: spawns whisper-cli with a synthetic 1-second
   * silent WAV to verify the model loads and the binary is compatible.  Uses
   * a short timeout (15s) since this is a compatibility check, not a benchmark.
   * whisper-bench.exe is NOT used — it measures speed, not compatibility.
   */
  async validateModelAsync(modelPath: string): Promise<ValidationResult> {
    if (!existsSync(modelPath)) {
      return { ok: false, exitCode: null, error: 'Model file not found', errorType: 'not_found' }
    }
    const cliPath = this.resolveCliPath()
    if (!existsSync(cliPath)) {
      return { ok: false, exitCode: null, error: 'whisper-cli binary not found', errorType: 'not_found' }
    }

    const cacheKey = `${cliPath}:${basename(modelPath)}`
    const cached = WhisperService.validationCache.get(cacheKey)
    if (cached) {
      console.log(`[WhisperService] Validation cache HIT for ${basename(modelPath)}: ok=${cached.ok}${cached.error ? ` (${cached.error})` : ''}`)
      return cached
    }

    // Generate a 1-second silent 16kHz mono WAV (44 bytes header + 32000 samples)
    // This is the minimum valid WAV that whisper-cli can process to verify model load.
    const dummyWav = join(tmpdir(), `whisper_smoke_${randomUUID()}.wav`)
    try {
      const sampleRate = 16000
      const numSamples = sampleRate // 1 second
      const dataSize = numSamples * 2 // 16-bit PCM
      const header = Buffer.alloc(44)
      header.write('RIFF', 0)
      header.writeUInt32LE(36 + dataSize, 4)
      header.write('WAVE', 8)
      header.write('fmt ', 12)
      header.writeUInt32LE(16, 16) // chunk size
      header.writeUInt16LE(1, 20)  // PCM
      header.writeUInt16LE(1, 22)  // mono
      header.writeUInt32LE(sampleRate, 24)
      header.writeUInt32LE(sampleRate * 2, 28) // byte rate
      header.writeUInt16LE(2, 32)  // block align
      header.writeUInt16LE(16, 34) // bits per sample
      header.write('data', 36)
      header.writeUInt32LE(dataSize, 40)
      const silence = Buffer.alloc(dataSize, 0)
      writeFileSync(dummyWav, Buffer.concat([header, silence]))

      // Smoke test: load model + transcribe 1 second of silence.
      // Small models can take >15s to cold-load on Windows, so keep this
      // timeout long enough to avoid false "not compatible" startup warnings.
      const result = await this.spawnForValidation(cliPath, [
        '-m', modelPath, '-f', dummyWav, '-t', '1', '-ng', '-nfa', '-l', 'en', '-osrt'
      ], 45000)

      WhisperService.validationCache.set(cacheKey, result)

      // On success, persist to disk cache
      if (result.ok) {
        const { app } = require('electron')
        const pkg = require(join(app.getAppPath(), 'package.json'))
        WhisperService.savePersistentCache({
          modelFile: basename(modelPath),
          modelHash: WhisperService.hashFile(modelPath),
          whisperVersion: '1.8.x',
          appVersion: pkg.version || '1.0.0',
          validated: true,
          lastSuccess: Date.now()
        })
      }

      return result
    } finally {
      try { unlinkSync(dummyWav) } catch { /* ignore */ }
    }
  }

  /**
   * Resolve the best available model using the fallback chain.
   * ASYNC — uses spawn (not spawnSync) so it never blocks the main thread.
   *
   * Error-type discrimination:
   *   - 'crash' / 'not_found'     → model is incompatible, try next
   *   - 'timeout'                 → model may work with more time, SKIP (don't mark as fail)
   *   - 'startup_failed' / unknown → try next
   *
   * @param fastOnly  When true, skips ALL process spawn — just checks file
   *                  existence.  Use at startup for instant resolution.
   */
  async resolveModelPathAsync(fastOnly = false): Promise<string> {
    // ---- Session-level cache: skip entire fallback chain if already resolved ----
    if (this._resolvedModelPathCache && existsSync(this._resolvedModelPathCache)) {
      this._startupValidated = true
      return this._resolvedModelPathCache
    }

    const modelDir = dirname(this.modelPath)
    const primaryModel = basename(this.modelPath)
    const candidateModels = [
      primaryModel,
      ...WhisperService.FALLBACK_MODELS.filter((fileName) => fileName !== primaryModel)
    ]
    const triedModels: ModelCompatibilityInfo['triedModels'] = []

    for (let i = 0; i < candidateModels.length; i++) {
      const fileName = candidateModels[i]
      const candidatePath = join(modelDir, fileName)

      // Check model dir first, then models-test dir as secondary source
      const altPath = join(dirname(modelDir), 'models-test', fileName)
      const testPath = existsSync(candidatePath) ? candidatePath
        : existsSync(altPath) ? altPath
        : null

      if (!testPath) {
        triedModels.push({ file: fileName, ok: false, exitCode: null, error: 'File not found', errorType: 'not_found' })
        continue
      }

      // fastOnly mode: skip ALL spawn — just check file existence + GGML header
      if (fastOnly) {
        const header = this.readGgmlHeader(testPath)
        const headerOk = header.valid
        const headerNote = headerOk
          ? `Header OK (ftype=${header.ftype}, v${header.version})`
          : `Header check failed: ${header.error}`
        this.activeModelPath = testPath
        this.lastValidation = {
          activeModel: fileName,
          primaryOk: i === 0,
          fallbackLevel: i,
          triedModels: [...triedModels, {
            file: fileName,
            ok: headerOk,
            exitCode: null,
            error: headerNote,
            errorType: headerOk ? undefined : 'unknown'
          }]
        }
        console.log(`[WhisperService] Model resolved (fast): ${fileName} — ${headerNote}`)
        this._resolvedModelPathCache = testPath
        return testPath
      }

      // Full async validation
      let result: ValidationResult
      try {
        result = await this.validateModelAsync(testPath)
      } catch (err) {
        result = { ok: false, exitCode: null, error: `validateModel threw: ${(err as Error).message}`, errorType: 'unknown' }
      }

      triedModels.push({
        file: fileName,
        ok: result.ok,
        exitCode: result.exitCode,
        error: result.error,
        errorType: result.errorType
      })

      if (result.ok) {
        this.activeModelPath = testPath
        this.lastValidation = {
          activeModel: fileName,
          primaryOk: i === 0,
          fallbackLevel: i,
          triedModels
        }
        console.log(`[WhisperService] Model resolved: ${fileName} (fallback level ${i})`)
        this._resolvedModelPathCache = testPath
        this._startupValidated = true
        return testPath
      }

      // Timeout is NOT a compatibility failure. If the file is a valid GGML
      // model, use it with a warning instead of telling the UI there is no
      // compatible model; real transcription uses a longer-running process.
      if (result.errorType === 'timeout') {
        const header = this.readGgmlHeader(testPath)
        if (header.valid) {
          this.activeModelPath = testPath
          this.lastValidation = {
            activeModel: fileName,
            primaryOk: i === 0,
            fallbackLevel: i,
            triedModels
          }
          console.warn(`[WhisperService] Model ${fileName} validation timed out but GGML header is valid — using it with caution`)
          this._resolvedModelPathCache = testPath
          this._startupValidated = true
          return testPath
        }
        console.warn(`[WhisperService] Model ${fileName} timed out and header check failed — trying next fallback`)
      } else if (result.error) {
        console.warn(`[WhisperService] Model ${fileName} failed validation: ${result.error} (${result.errorType || 'unspecified'})`)
      }
    }

    // No model works — report failure with discriminated error types
    this.lastValidation = {
      activeModel: 'none',
      primaryOk: false,
      fallbackLevel: -1,
      triedModels
    }
    console.error('[WhisperService] No compatible model found in fallback chain')
    return this.modelPath
  }

  /**
   * Synchronous wrapper kept for backward compatibility.
   * @deprecated Use resolveModelPathAsync() for non-blocking validation.
   */
  resolveModelPath(fastOnly = false): string {
    // Fast mode is instant — keep it sync
    if (fastOnly) {
      const modelDir = dirname(this.modelPath)
      for (let i = 0; i < WhisperService.FALLBACK_MODELS.length; i++) {
        const fileName = WhisperService.FALLBACK_MODELS[i]
        const candidatePath = join(modelDir, fileName)
        const altPath = join(dirname(modelDir), 'models-test', fileName)
        const testPath = existsSync(candidatePath) ? candidatePath
          : existsSync(altPath) ? altPath
          : null
        if (testPath) {
          const header = this.readGgmlHeader(testPath)
          const note = header.valid
            ? `Header OK (ftype=${header.ftype}, v${header.version})`
            : `Header check failed: ${header.error}`
          this.activeModelPath = testPath
          this.lastValidation = {
            activeModel: fileName,
            primaryOk: i === 0,
            fallbackLevel: i,
            triedModels: [{
              file: fileName,
              ok: header.valid,
              exitCode: null,
              error: note,
              errorType: header.valid ? undefined : 'unknown'
            }]
          }
          return testPath
        }
      }
      return this.modelPath
    }
    // Full mode with spawnSync for backward compat (diagnostics)
    const modelDir = dirname(this.modelPath)
    const triedModels: ModelCompatibilityInfo['triedModels'] = []
    for (let i = 0; i < WhisperService.FALLBACK_MODELS.length; i++) {
      const fileName = WhisperService.FALLBACK_MODELS[i]
      const candidatePath = join(modelDir, fileName)
      const altPath = join(dirname(modelDir), 'models-test', fileName)
      const testPath = existsSync(candidatePath) ? candidatePath
        : existsSync(altPath) ? altPath
        : null
      if (!testPath) {
        triedModels.push({ file: fileName, ok: false, exitCode: null, error: 'File not found', errorType: 'not_found' })
        continue
      }
      const result = this.runTest(
        join(dirname(this.resolveCliPath()), process.platform === 'win32' ? 'whisper-bench.exe' : 'whisper-bench'),
        ['-m', testPath, '-t', '1', '-ng'],
        30000
      )
      triedModels.push({ file: fileName, ok: result.ok, exitCode: result.exitCode, error: result.error, errorType: result.errorType })
      if (result.ok) {
        this.activeModelPath = testPath
        this.lastValidation = { activeModel: fileName, primaryOk: i === 0, fallbackLevel: i, triedModels }
        return testPath
      }
    }
    this.lastValidation = { activeModel: 'none', primaryOk: false, fallbackLevel: -1, triedModels }
    return this.modelPath
  }

  /**
   * Returns the active model path (may have been resolved via fallback).
   */
  getActiveModelPath(): string {
    return this.activeModelPath
  }

  /** Use a newly installed model without requiring an application restart. */
  setModelPath(modelPath: string): void {
    this.modelPath = modelPath
    this.activeModelPath = modelPath
    this.lastValidation = null
    this.invalidateModelCache()
  }

  /**
   * Invalidate the session-level model resolve cache.
   * Call this when the user changes models or when you need to force
   * a fresh resolution (e.g. after downloading a new model).
   */
  invalidateModelCache(): void {
    this._resolvedModelPathCache = null
    this._startupValidated = false
  }

  /**
   * Mark environment as validated — call this after startup validation succeeds.
   * Prevents redundant checkEnvironment() calls on every transcription.
   */
  markStartupValidated(): void {
    this._startupValidated = true
  }

  /**
   * Returns the last model validation results (for diagnostics display).
   */
  getLastValidation(): ModelCompatibilityInfo | null {
    return this.lastValidation
  }

  /**
   * Detect CPU features — architecture-based heuristic from CPU model string.
   *
   * WMI `Caption` only returns family/model/stepping (e.g. "Intel64 Family 6
   * Model 183 Stepping 1") — it NEVER contains instruction-set feature strings
   * like "avx2".  WMIC is also removed on Windows 11 24H2+.
   *
   * Instead we parse the CPU brand from os.cpus() (always available, no spawn)
   * and apply known-generation feature tables.  Unrecognized CPUs default to
   * SAFE (all false → compat binary), never to AVX2-capable.
   */
  private detectCpuFeatures(): {
    name: string; hasAVX2: boolean; hasAVX: boolean
    hasFMA: boolean; hasSSE41: boolean; hasSSE42: boolean
  } {
    const osCpus = cpus()
    const model = osCpus[0]?.model || 'Unknown CPU'
    const name = model.toLowerCase()

    // ---- macOS ----------------------------------------------------------
    // Apple Silicon always supports these; Intel Macs 2013+ (Haswell) do too.
    if (process.platform === 'darwin') {
      return { name: model, hasAVX2: true, hasAVX: true, hasFMA: true, hasSSE41: true, hasSSE42: true }
    }

    // ---- Linux ----------------------------------------------------------
    // /proc/cpuinfo 'flags' line is the ground truth.  Keep it as primary.
    if (process.platform === 'linux') {
      let linuxFeatures = ''
      try {
        const result = spawnSync('grep', ['-m1', 'flags', '/proc/cpuinfo'], { timeout: 2000 })
        linuxFeatures = (result.stdout || '').toString('utf8').toLowerCase()
      } catch { /* fall through */ }
      return {
        name: model,
        hasAVX2: linuxFeatures.includes('avx2'),
        hasAVX: linuxFeatures.includes('avx'),
        hasFMA: linuxFeatures.includes('fma'),
        hasSSE41: linuxFeatures.includes('sse4_1') || linuxFeatures.includes('sse4.1'),
        hasSSE42: linuxFeatures.includes('sse4_2') || linuxFeatures.includes('sse4.2')
      }
    }

    // ---- Windows --------------------------------------------------------
    // Architecture heuristic — the ONLY reliable method without a native
    // CPUID addon, since WMI/PowerShell Caption strings lack feature info.

    // Intel Core i3/i5/i7/i9: generation encoded in model number.
    //   i7-14700  → 14th gen (Raptor Lake Refresh)
    //   i5-8250U  →  8th gen (Kaby Lake R)
    //   i9-13900K → 13th gen (Raptor Lake)
    const intelMatch = name.match(/i[3579][- ](\d{1,2})\d{3}/)
    const intelGen = intelMatch ? parseInt(intelMatch[1], 10) : 0

    // AMD Ryzen: any generation (2017+) supports all features.
    const amdRyzenMatch = name.includes('ryzen')

    // ---- Intel generation table -----------------------------------------
    // 2nd gen+ (Sandy Bridge, 2011): SSE4.1, SSE4.2, AVX
    // 4th gen+ (Haswell, 2013):      +AVX2, +FMA
    // Celeron N/J-series (Apollo Lake+, 2016): SSE4.1/SSE4.2 only
    // Unknown Intel: SAFE (all false → compat binary)
    if (intelGen >= 4) {
      return { name: model, hasAVX2: true, hasAVX: true, hasFMA: true, hasSSE41: true, hasSSE42: true }
    }
    if (intelGen >= 2) {
      return { name: model, hasAVX2: false, hasAVX: true, hasFMA: false, hasSSE41: true, hasSSE42: true }
    }
    // Intel Atom/Celeron/Pentium Silver (Apollo Lake+): SSE4.x but no AVX
    const isIntelAtom = name.includes('celeron') || name.match(/pentium.*silver/)
    if (isIntelAtom) {
      // Conservative: only SSE4.x.  Apollo Lake (2016) and later actually
      // have SSE4.1/SSE4.2 but NOT AVX.  Older Atoms may lack even SSE4.x,
      // but those are ancient — err on the side of compat binary anyway.
      return { name: model, hasAVX2: false, hasAVX: false, hasFMA: false, hasSSE41: false, hasSSE42: false }
    }

    // ---- AMD generation table -------------------------------------------
    // Ryzen (all generations, 2017+): SSE4.1, SSE4.2, AVX, AVX2, FMA
    if (amdRyzenMatch) {
      return { name: model, hasAVX2: true, hasAVX: true, hasFMA: true, hasSSE41: true, hasSSE42: true }
    }
    // AMD FX / A-series (Bulldozer through Excavator, 2011-2016):
    //   SSE4.1, SSE4.2, AVX, FMA.  NO AVX2 (except Excavator, rare).
    const isAmdFx = name.includes('fx-') || name.match(/a[468]-/) || name.includes('athlon')
    if (isAmdFx) {
      return { name: model, hasAVX2: false, hasAVX: true, hasFMA: true, hasSSE41: true, hasSSE42: true }
    }

    // ---- Unknown CPU ----------------------------------------------------
    // Default to SAFE: no advanced features assumed.  This guarantees
    // resolveCliPath() picks the compat binary (or falls through to default).
    console.warn(`[WhisperService] Unrecognized CPU model "${model}" — defaulting to compat (no AVX/AVX2/FMA)`)
    return { name: model, hasAVX2: false, hasAVX: false, hasFMA: false, hasSSE41: false, hasSSE42: false }
  }

  /**
   * Validate environment before attempting transcription.
   * Uses async spawn so the renderer stays responsive.
   *
   * Error-type discrimination:
   *   - crash / not_found  → block transcription (model incompatible)
   *   - timeout            → warn but proceed (model may work with more time)
   */
  async checkEnvironment(): Promise<{ ok: boolean; reason?: string; warning?: string }> {
    const cliPath = this.resolveCliPath()
    if (!existsSync(cliPath)) {
      return { ok: false, reason: `whisper-cli binary not found at: ${cliPath}` }
    }

    // Smoke test: can the binary even start?  (sync — spawnSync with 8s timeout is fine)
    try {
      const smoke = spawnSync(cliPath, ['-h'], { timeout: 8000, windowsHide: true })
      if (smoke.status !== 0 || smoke.error) {
        const errMsg = smoke.error?.message || `exit code ${smoke.status}`
        return { ok: false, reason: `whisper-cli binary failed to start: ${errMsg}` }
      }
    } catch (e) {
      return { ok: false, reason: `whisper-cli binary failed to start: ${(e as Error).message}` }
    }

    // Resolve the best available model via async fallback chain (non-blocking)
    const resolvedPath = await this.resolveModelPathAsync()
    if (!existsSync(resolvedPath)) {
      return { ok: false, reason: `No compatible Whisper model found. Tried: ${WhisperService.FALLBACK_MODELS.join(', ')}` }
    }

    // If we fell back, surface it
    if (this.lastValidation && !this.lastValidation.primaryOk && this.lastValidation.fallbackLevel >= 0) {
      const activeModel = this.lastValidation.activeModel
      console.warn(`[WhisperService] Primary model incompatible — using fallback: ${activeModel}`)
    }

    // Analyse failures with discriminated error types
    if (this.lastValidation && this.lastValidation.fallbackLevel < 0 && this.lastValidation.triedModels.length > 0) {
      const crashFailures = this.lastValidation.triedModels
        .filter(m => !m.ok && m.errorType === 'crash')
      const timeoutFailures = this.lastValidation.triedModels
        .filter(m => !m.ok && m.errorType === 'timeout')
      const otherFailures = this.lastValidation.triedModels
        .filter(m => !m.ok && m.errorType !== 'crash' && m.errorType !== 'timeout')

      // If ALL failures are timeouts, the models may be fine — just slow
      if (crashFailures.length === 0 && timeoutFailures.length > 0 && otherFailures.length === 0) {
        const names = timeoutFailures.map(m => m.file).join(', ')
        return {
          ok: true,
          warning: `Model validation timed out for: ${names}. The model may still work — proceeding with caution. Run Diagnostics to verify.`
        }
      }

      // Some models crashed — genuinely incompatible
      const allFailures = this.lastValidation.triedModels
        .filter(m => !m.ok)
        .map(m => `${m.file}(${m.error || m.errorType || 'crash'})`)
        .join(', ')
      return { ok: false, reason: `Installed model is incompatible with this whisper build. Failed models: ${allFailures}. Download a compatible model from https://huggingface.co/ggerganov/whisper.cpp` }
    }

    const { hasAVX2, name } = this.detectCpuFeatures()
    if (!hasAVX2 && process.platform === 'win32') {
      console.warn(`[WhisperService] CPU "${name}" may not support AVX2. Proceeding with -ng -nfa flags.`)
    }
    return { ok: true }
  }

  /**
   * Full diagnostics report for the Diagnostics button in the UI.
   */
  getDiagnostics(): DiagnosticsResult {
    const cliPath = this.resolveCliPath()
    const { name: cpuName, hasAVX2, hasAVX, hasFMA, hasSSE41, hasSSE42 } = this.detectCpuFeatures()
    const vcRuntime = process.platform === 'win32'
      ? existsSync('C:\\Windows\\System32\\msvcp140.dll')
      : true

    // Try to get whisper version
    let whisperVersion = 'unknown'
    try {
      if (existsSync(cliPath)) {
        const ver = spawnSync(cliPath, ['-h'], { timeout: 5000, windowsHide: true })
        const out = (ver.stdout || '').toString('utf8')
        const match = out.match(/whisper\s+(?:cli\s+)?v?([\d.]+)/i) || out.match(/version\s*:?\s*v?([\d.]+)/i)
        if (match) whisperVersion = match[1]
      }
    } catch { /* non-critical */ }

    return {
      binary: existsSync(cliPath),
      binaryPath: cliPath,
      model: existsSync(this.modelPath),
      modelPath: this.modelPath,
      cpuAVX2: hasAVX2,
      cpuAVX: hasAVX,
      cpuFMA: hasFMA,
      cpuSSE41: hasSSE41,
      cpuSSE42: hasSSE42,
      cpuName,
      vcRuntime,
      ramTotalMB: Math.round(totalmem() / (1024 * 1024)),
      osVersion: `${process.platform} ${release()}`,
      whisperVersion,
      modelCompatibility: this.lastValidation ?? undefined
    }
  }

  /**
   * Run live diagnostic tests that spawn whisper-cli in controlled scenarios.
   * Returns structured pass/fail for each test.  Model/audio tests may CRASH
   * (exit code 0xC0000409 = STACK_BUFFER_OVERRUN) when binary and model are
   * incompatible — the crash is caught and reported, not propagated.
   */
  runDiagnosticTests(): DiagnosticTests {
    const cliPath = this.resolveCliPath()
    const modelPath = this.modelPath

    // --- Binary Help Test ---
    const binaryHelp = this.runTest(cliPath, ['-h'], 8000)

    // --- Model Load Test ---
    // Try loading the model and running a zero-length encode via bench --no-timing.
    // If the binary/model are incompatible this WILL produce STACK_BUFFER_OVERRUN.
    const modelLoad = this.runTest(cliPath, [
      '-m', modelPath,
      '-t', '1',
      '-ng',
      '-nfa',
      '-l', 'en'
    ], 15000)

    // --- Audio Process Test ---
    // Full pipeline with a known-good audio file (if available).
    // Without a guaranteed test file this is skipped.
    const audioProcess = { ok: false, exitCode: null as number | null, error: 'No test audio file configured' }

    return { binaryHelp, modelLoad, audioProcess }
  }

  /** Spawn a child process and return whether it exited cleanly (code 0). */
  private runTest(cliPath: string, args: string[], timeoutMs: number): ValidationResult {
    try {
      const proc = spawnSync(cliPath, args, {
        timeout: timeoutMs,
        windowsHide: true,
        encoding: 'buffer'
      })
      if (proc.error) {
        // Distinguish timeout from other spawn errors
        const errorType: ValidationErrorType =
          (proc.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timeout' : 'startup_failed'
        return { ok: false, exitCode: null, error: proc.error.message, errorType }
      }
      if (proc.status !== 0) {
        const unsignedCode = ((proc.status ?? 0) >>> 0)
        const hex = unsignedCode.toString(16).toUpperCase()
        // Known Windows crash codes
        const crashCodes = new Set([0xC0000409, 0xC0000005, 0xC000001D, 0xC0000135])
        const errorType: ValidationErrorType = crashCodes.has(unsignedCode) ? 'crash' : 'unknown'
        return { ok: false, exitCode: proc.status, error: `Exit code ${proc.status} (0x${hex})`, errorType }
      }
      return { ok: true, exitCode: 0 }
    } catch (e) {
      return { ok: false, exitCode: null, error: (e as Error).message, errorType: 'unknown' }
    }
  }

  /**
   * Parse whisper.cpp JSON output into token arrays per segment.
   * Returns null if parsing fails (triggers synthetic fallback).
   *
   * Whisper JSON structure (v1.8.x):
   *   { transcription: [{ offsets: { from, to }, tokens: [{ text, offsets: { from, to } }] }] }
   *
   * Alternate structures from different whisper.cpp builds:
   *   { result: { segments: [...] } }  — older builds
   *   { segments: [...] }              — server-mode
   *
   * Token-to-word merging rule:
   *   - BPE tokens start with a space to mark word boundaries
   *   - Subword continuations (no space prefix) merge into the current word
   *   - Word startMs = first token start, endMs = last token end
   *
   * Verified with test cases:
   *   "don't"  → [" don", "'t"]          → "don't"
   *   "I'm"    → [" I", "'m"]            → "I'm"
   *   "CapCraft"   → [" Cap", "Craft"]        → "CapCraft"
   *   "AI-powered" → [" AI", "-powered"]      → "AI-powered"
   *   "GPT-5"      → [" G", "PT", "-", "5"]   → "GPT-5"
   *   "T-Selection"→ [" T", "-Selection"]     → "T-Selection"
   */
  /**
   * Minimum token ID for whisper.cpp special tokens (e.g., [BLANK], [SOT], [EOT], etc.).
   * Tokens at or above this ID are control tokens with no linguistic meaning or timing.
   * Reference: whisper.cpp ggml headers.
   */
  private static readonly WHISPER_SPECIAL_TOKEN_MIN_ID = 50364

  private static parseJsonTokens(jsonContent: string): Array<Array<{ word: string; startMs: number; endMs: number }>> | null {
    let parsed: any
    try {
      // UTF-8 policy (Phase 9): whisper.cpp may emit a BOM; strip it or
      // JSON.parse throws and word timestamps silently fall back.
      parsed = JSON.parse(stripBOM(jsonContent))
    } catch {
      console.warn('[WhisperService] JSON parse failed — invalid JSON syntax')
      return null
    }

    // Try multiple known whisper.cpp JSON structures
    let segments: any[] | null = null
    let structureLabel = 'unknown'

    if (Array.isArray(parsed?.transcription) && parsed.transcription.length > 0) {
      segments = parsed.transcription
      structureLabel = 'v1.8.x (transcription array)'
    } else if (Array.isArray(parsed?.result?.segments) && parsed.result.segments.length > 0) {
      segments = parsed.result.segments
      structureLabel = 'older build (result.segments)'
    } else if (Array.isArray(parsed?.segments) && parsed.segments.length > 0) {
      segments = parsed.segments
      structureLabel = 'server-mode (segments)'
    }

    if (!segments) {
      const keys = parsed ? Object.keys(parsed).join(', ') : '(empty)'
      console.warn(`[WhisperService] JSON structure not recognized. Top-level keys: ${keys}`)
      return null
    }

    console.log(`[WhisperService] JSON structure detected: ${structureLabel}, ${segments.length} segments`)

    // Diagnostic: dump first segment's keys to identify field names
    if (segments.length > 0) {
      const firstSegKeys = Object.keys(segments[0]).join(', ')
      const hasTokens = 'tokens' in segments[0]
      const hasTokenLevel = (segments[0] as any)?.token_level !== undefined
      console.log(`[WhisperService] First segment keys: [${firstSegKeys}], hasTokens=${hasTokens}, hasTokenLevel=${hasTokenLevel}`)
    }

    let totalTokens = 0
    let totalWords = 0
    let segmentsWithTokens = 0
    let segmentsWithoutTokens = 0

    const result = segments.map((seg: any, segIdx: number) => {
      const tokens: any[] = seg?.tokens
      if (!Array.isArray(tokens) || tokens.length === 0) {
        segmentsWithoutTokens++
        return []
      }

      segmentsWithTokens++
      totalTokens += tokens.length

      const segFrom: number = seg?.offsets?.from ?? seg?.t0 ?? 0
      const segTo: number = seg?.offsets?.to ?? seg?.t1 ?? 0
      const words: Array<{ word: string; startMs: number; endMs: number }> = []
      let currentWordTokens: Array<{ text: string; startMs: number; endMs: number }> = []

      for (const tok of tokens) {
        const tokText: string = tok?.text ?? ''
        // Skip whisper.cpp special tokens (IDs >= 50364: [_BEG_], [_TT_NNN], etc.).
        // -ojf emits ALL decoded tokens including control markers, which corrupt
        // word text and timing if not filtered here.
        const tokId: number | undefined = tok?.id
        if (tokId !== undefined && tokId >= WhisperService.WHISPER_SPECIAL_TOKEN_MIN_ID) continue
        // Try multiple timestamp field names (whisper.cpp versions differ)
        const from: number = tok?.offsets?.from ?? tok?.t0 ?? tok?.timestamps?.from ?? 0
        const to: number = tok?.offsets?.to ?? tok?.t1 ?? tok?.timestamps?.to ?? 0

        if (from === 0 && to === 0 && tokText.length > 0) {
          // Token has text but no timing — suspicious, log once per segment
          if (currentWordTokens.length === 0 && words.length === 0) {
            console.warn(`[WhisperService] Segment ${segIdx}: tokens missing timestamp fields (offsets.from/to, t0/t1). Falling back to synthetic for this segment.`)
          }
          // Return empty to force synthetic fallback for this segment
          return []
        }

        // A token starting with space indicates a new word boundary
        if (tokText.startsWith(' ') && currentWordTokens.length > 0) {
          const wordText = currentWordTokens.map((t) => t.text).join('').replace(/^\s+/, '').trim()
          if (wordText) {
            const wStart = currentWordTokens[0].startMs
            const wEnd = currentWordTokens[currentWordTokens.length - 1].endMs
            // Sanity: word timing must be within segment bounds
            if (wEnd < wStart || wStart < segFrom || wEnd > segTo + 50) {
              console.warn(`[WhisperService] Segment ${segIdx}: word "${wordText}" timing [${wStart},${wEnd}] outside segment [${segFrom},${segTo}] — discarding`)
            } else {
              words.push({ word: wordText, startMs: wStart, endMs: wEnd })
            }
          }
          currentWordTokens = []
        }

        if (tokText.trim()) {
          currentWordTokens.push({ text: tokText, startMs: from, endMs: to })
        }
      }

      // Flush final word
      if (currentWordTokens.length > 0) {
        const wordText = currentWordTokens.map((t) => t.text).join('').replace(/^\s+/, '').trim()
        if (wordText) {
          const wStart = currentWordTokens[0].startMs
          const wEnd = currentWordTokens[currentWordTokens.length - 1].endMs
          if (wEnd >= wStart && wStart >= segFrom - 10) {
            words.push({ word: wordText, startMs: wStart, endMs: wEnd })
          }
        }
      }

      totalWords += words.length

      // Validate word count roughly matches text word count
      if (words.length > 0 && seg?.text) {
        const textWordCount = (seg.text as string).split(/\s+/).filter(Boolean).length
        if (Math.abs(words.length - textWordCount) > textWordCount * 0.5) {
          console.warn(`[WhisperService] Segment ${segIdx}: token-merged word count (${words.length}) differs significantly from text word count (${textWordCount}). Text: "${seg.text}"`)
        }
      }

      return words
    })

    console.log(
      `[WhisperService] JSON parse summary: ${segmentsWithTokens}/${segments.length} segments have tokens, ` +
      `${totalTokens} tokens → ${totalWords} words. ` +
      `${segmentsWithoutTokens} segments will use synthetic fallback.`
    )

    // If most segments lack tokens, the JSON is effectively useless
    if (segmentsWithTokens === 0) {
      console.warn('[WhisperService] No segments contain token arrays — JSON output is present but empty. Using synthetic fallback.')
      return null
    }

    return result
  }
  
  /**
   * Fallback: distribute segment duration evenly across words by character count.
   * Returns words marked as synthetic with timestamps RELATIVE to segment start (0-based).
   */
  private static syntheticWords(text: string, startMs: number, endMs: number): Array<{ word: string; startMs: number; endMs: number; synthetic: true }> {
    const rawWords = text.split(/\s+/).filter(Boolean)
    if (rawWords.length <= 1) return []
  
    // Proportional by character count (more accurate than even split)
    const totalChars = rawWords.reduce((sum, w) => sum + w.length, 0)
    const durationMs = endMs - startMs
    let cursor = 0
  
    return rawWords.map((word) => {
      const wordDuration = Math.round(durationMs * (word.length / totalChars))
      const wStart = cursor
      const wEnd = cursor + wordDuration
      cursor = wEnd
      return { word, startMs: wStart, endMs: wEnd, synthetic: true as const }
    })
  }
  
  /** Parse SRT content into CaptionEntry[] with optional JSON token data for word timestamps */
  private static parseSRTOutput(content: string, wordTimestamps: boolean, jsonTokens?: Array<Array<{ word: string; startMs: number; endMs: number }>> | null): { entries: CaptionEntry[]; driftMs?: { min: number; max: number; mean: number; count: number } } {
    // Delegate block-level SRT parsing to shared utility, then enrich with whisper-specific processing
    const rawEntries = parseSRT(content)
    const entries: CaptionEntry[] = []

    // Drift tracking: compare whisper timestamps vs synthetic (character-count) estimates
    let driftDiffs: number[] = []

    for (const raw of rawEntries) {
      const startMs = raw.startMs
      const endMs = raw.endMs

      // Whisper SRT: strip HTML tags, join multiline with spaces
      const text = raw.text.replace(/\n/g, ' ').replace(/<\/?[^>]+(>|$)/g, '').trim()

      if (text) {
        const idx = rawEntries.indexOf(raw)
        const entry: CaptionEntry = {
          id: raw.id,
          startMs,
          endMs,
          text
        }

        if (wordTimestamps && text.includes(' ')) {
          // Prefer actual Whisper token timestamps from JSON
          const tokenWords = jsonTokens?.[idx]
          if (tokenWords && tokenWords.length > 0) {
            const textWords = text.split(/\s+/).filter(Boolean)
            // Normalize absolute Whisper timestamps to be clip-relative (0-based).
            entry.words = tokenWords.map((w) => ({ word: w.word, startMs: w.startMs - startMs, endMs: w.endMs - startMs }))
            entry.wordTimestampsSource = 'whisper'

            // Compute drift: compare whisper vs synthetic for the same segment
            if (tokenWords.length === textWords.length) {
              const synthetic = WhisperService.syntheticWords(text, startMs, endMs)
              for (let i = 0; i < tokenWords.length; i++) {
                const driftStart = Math.abs((tokenWords[i].startMs - startMs) - synthetic[i].startMs)
                const driftEnd = Math.abs((tokenWords[i].endMs - startMs) - synthetic[i].endMs)
                driftDiffs.push(driftStart, driftEnd)
              }
            }
          } else {
            // Fallback: proportional character-count estimation
            entry.words = WhisperService.syntheticWords(text, startMs, endMs)
            entry.wordTimestampsSource = 'synthetic'
          }
        }

        entries.push(entry)
      }
    }

    // Compute drift statistics
    let driftMs: { min: number; max: number; mean: number; count: number } | undefined
    if (driftDiffs.length > 0) {
      const sum = driftDiffs.reduce((a, b) => a + b, 0)
      driftMs = {
        min: Math.round(Math.min(...driftDiffs)),
        max: Math.round(Math.max(...driftDiffs)),
        mean: Math.round(sum / driftDiffs.length),
        count: driftDiffs.length
      }
      console.log(`[WhisperService] Word timing drift (whisper vs synthetic): min=${driftMs.min}ms max=${driftMs.max}ms mean=${driftMs.mean}ms (${driftMs.count} samples)`)
    }

    return { entries, driftMs }
  }
}
