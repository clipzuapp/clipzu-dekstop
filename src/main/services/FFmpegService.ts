import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { StringDecoder } from 'string_decoder'
import { app } from 'electron'
import { toAssColor } from '../../shared/utils/color'
import type { ExportCaptionStyle } from '../../shared/utils/srt'
import {
  escapeFilterPath as sharedEscapeFilterPath,
  formatStderrMessage as sharedFormatStderrMessage,
  classifyFfmpegError as sharedClassifyFfmpegError,
  buildFfmpegError as sharedBuildFfmpegError,
  withEnableWindow,
  appendCappedText,
} from '../../shared/export/ffmpegText'
import type {
  ExportAnimatedFilter,
  ExportTimeSegment,
  SlideGeometry,
  ZoomGeometry,
} from '../../shared/export/exportGraph'
import { fmtFilterNumber } from '../../shared/export/exportGraph'

/** Cap on retained stderr per process (Phase 8): ring, not concat-O(n^2). */
const MAX_RETAINED_STDERR = 16 * 1024

/**
 * Append a chunk to a capped stderr buffer (shared helper).
 */
function appendCappedStderr(current: string, chunk: string): string {
  return appendCappedText(current, chunk, MAX_RETAINED_STDERR)
}

/**
 * Build an animated scale expression for a zoom transition.
 * scale(t) = from -> to across [start,end] (absolute seconds); 1 otherwise.
 * Caller wraps it in single quotes inside the scale filter (contains commas).
 */
function zoomScaleExpr(geom: ZoomGeometry, clipStartMs: number): string {
  const spanSec = (geom.endMs - geom.startMs) / 1000
  if (spanSec <= 0) return '1'
  const s = ((clipStartMs + geom.startMs) / 1000).toFixed(3)
  const e = ((clipStartMs + geom.endMs) / 1000).toFixed(3)
  const delta = geom.toScale - geom.fromScale
  const expr = `${fmtFilterNumber(geom.fromScale)}+${fmtFilterNumber(delta)}*((t-${s})/${spanSec.toFixed(3)})`
  return `if(between(t,${s},${e}),${expr},1)`
}

/**
 * Build an animated overlay coordinate expression for a slide transition.
 * value(t) = base + dim*frac(p) while t ∈ [start,end] (absolute seconds);
 * base otherwise. `dim` is the output dimension on the geometry's axis.
 * Caller wraps the result in single quotes (it contains commas).
 */
function slideOffsetExpr(
  geom: SlideGeometry,
  baseValue: string,
  clipStartMs: number,
  dim: number
): string {
  const spanSec = (geom.endMs - geom.startMs) / 1000
  if (spanSec <= 0) return baseValue
  const s = ((clipStartMs + geom.startMs) / 1000).toFixed(3)
  const e = ((clipStartMs + geom.endMs) / 1000).toFixed(3)
  const delta = geom.toFrac - geom.fromFrac
  const frac = `${fmtFilterNumber(geom.fromFrac)}+${fmtFilterNumber(delta)}*((t-${s})/${spanSec.toFixed(3)})`
  return `if(between(t,${s},${e}),${baseValue}+${dim}*(${frac}),${baseValue})`
}

/** req 2.1 — Single authoritative CRF policy for export encoders */
const CRF_H264 = { fast: 20, slow: 18 } as const
const CRF_H265 = { fast: 24, slow: 20 } as const
const CRF_VP9 = { fast: 33, slow: 30 } as const

/** req 2.17 — Normalize all mixed audio to 48 kHz stereo float before processing */
const AUDIO_NORM_FILTER = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'

export interface ExportProbeResult {
  width: number
  height: number
  durationMs: number
  hasVideo: boolean
  hasAudio: boolean
}

/**
 * FFmpegService - All FFmpeg operations via child_process.spawn
 * OOP class with constructor dependency injection — no module-level mutable state.
 * NEVER uses execSync or spawnSync to avoid blocking the main process.
 */

export interface FFmpegProgress {
  timeMs: number
  percent: number
  fps: number
  speed: string
}

export interface ClipTransformExport {
  x: number; y: number
  scaleX: number; scaleY: number
  rotation: number
  opacity: number
  cropTop: number; cropBottom: number; cropLeft: number; cropRight: number
}

export type ProgressCallback = (progress: FFmpegProgress) => void

export class FFmpegService {
  /** Most recently spawned extraction/mix process — readable by Whisper handler for cancel support */
  public lastExtractionProcess: ChildProcess | null = null

  constructor(
    private readonly ffmpegPath: string,
    private readonly ffprobePath: string = ffmpegPath.replace('ffmpeg', 'ffprobe')
  ) {}

  /** Kill any tracked child processes to allow clean app exit */
  killAll(): void {
    if (this.lastExtractionProcess) {
      try { this.lastExtractionProcess.kill('SIGKILL') } catch { /* already exited */ }
      this.lastExtractionProcess = null
    }
  }

  /**
   * Resolve the bundled fonts directory for FFmpeg subtitles filter.
   * Returns null if the directory doesn't exist (subtitles will still render
   * with system fonts as fallback).
   */
  static getFontsDir(): string | null {
    // In production the fonts are bundled next to resources
    const candidates = [
      // Packaged: next to app resources
      ...(app.isPackaged
        ? [join(process.resourcesPath, 'fonts'), join(process.resourcesPath, 'assets', 'fonts')]
        : []),
      // Development: workspace assets/fonts
      join(app.getAppPath(), 'assets', 'fonts'),
      join(app.getAppPath(), '..', 'assets', 'fonts')
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  /**
   * Escape a path for use inside an FFmpeg filter graph string.
   * Delegates to the shared pure helper (unit-tested under node:test).
   */
  static escapeFilterPath(p: string): string {
    return sharedEscapeFilterPath(p)
  }

  /** req 2.20 — Include head and tail of stderr in error messages */
  static formatStderrMessage(stderr: string): string {
    return sharedFormatStderrMessage(stderr)
  }

  /** req 2.18 — Classify common FFmpeg failure patterns */
  static classifyFfmpegError(stderr: string): string | null {
    return sharedClassifyFfmpegError(stderr)
  }

  static buildFfmpegError(code: number | null, stderr: string): Error {
    return sharedBuildFfmpegError(code, stderr)
  }

  /** Parse FFmpeg stderr progress line */
  private static parseProgress(line: string, totalDurationMs: number): FFmpegProgress | null {
    const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/)
    if (!timeMatch) return null

    const hours = parseInt(timeMatch[1], 10)
    const minutes = parseInt(timeMatch[2], 10)
    const seconds = parseInt(timeMatch[3], 10)
    const centiseconds = parseInt(timeMatch[4], 10)
    const timeMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + centiseconds * 10

    const fpsMatch = line.match(/fps=\s*(\d+(?:\.\d+)?)/)
    const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 0

    const speedMatch = line.match(/speed=\s*([\d.]+x)/)
    const speed = speedMatch ? speedMatch[1] : '0x'

    const percent = totalDurationMs > 0 ? Math.min(100, (timeMs / totalDurationMs) * 100) : 0
    return { timeMs, percent, fps, speed }
  }

  /** Spawn a generic FFmpeg process */
  spawn(args: string[], totalDurationMs = 0, onProgress?: ProgressCallback): { process: ChildProcess; promise: Promise<void> } {
    const ffmpegProcess = spawn(this.ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.lastExtractionProcess = ffmpegProcess

    const promise = new Promise<void>((resolve, reject) => {
      let stderr = ''
      // UTF-8 policy (Phase 9): StringDecoder never splits a multi-byte
      // sequence across chunks (CJK/emoji log lines stay intact).
      const decoder = new StringDecoder('utf8')

      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const line = decoder.write(data)
        stderr = appendCappedStderr(stderr, line)
        if (onProgress) {
          const progress = FFmpegService.parseProgress(line, totalDurationMs)
          if (progress) onProgress(progress)
        }
      })

      ffmpegProcess.on('close', (code) => {
        if (code === 0) resolve()
        else reject(FFmpegService.buildFfmpegError(code, stderr))
      })

      ffmpegProcess.on('error', (err) => {
        reject(new Error(`FFmpeg spawn error: ${err.message}`))
      })
    })

    return { process: ffmpegProcess, promise }
  }

  /** Get media info via ffprobe */
  getMediaInfo(filePath: string): Promise<{
    durationMs: number; width: number; height: number; fps: number; codec: string; hasAudio: boolean; fileSize: number
  }> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', filePath
      ]

      const probeProcess = spawn(this.ffprobePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })

      let stdout = ''
      let stderr = ''
      const decoder = new StringDecoder('utf8')
      const errDecoder = new StringDecoder('utf8')

      probeProcess.stdout?.on('data', (data: Buffer) => { stdout += decoder.write(data) })
      probeProcess.stderr?.on('data', (data: Buffer) => { stderr = appendCappedStderr(stderr, errDecoder.write(data)) })

      probeProcess.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffprobe failed: ${stderr}`))
        try {
          const info = JSON.parse(stdout)
          const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video')
          const audioStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio')

          // Support audio-only files — use audio stream or format duration
          const durationSec = parseFloat(
            info.format?.duration || videoStream?.duration || audioStream?.duration || '0'
          )

          // Video-specific fields default to 0 for audio-only files
          let fps = 0
          if (videoStream) {
            const fpsStr = videoStream.r_frame_rate || '30/1'
            const [fpsNum, fpsDen] = fpsStr.split('/').map(Number)
            fps = fpsDen ? fpsNum / fpsDen : fpsNum
          }

          resolve({
            durationMs: Math.round(durationSec * 1000),
            width: videoStream?.width || 0,
            height: videoStream?.height || 0,
            fps: Math.round(fps),
            codec: videoStream?.codec_name || audioStream?.codec_name || 'unknown',
            hasAudio: !!audioStream,
            fileSize: Math.round(parseFloat(info.format?.size || '0'))
          })
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${(e as Error).message}`))
        }
      })

      probeProcess.on('error', (err) => reject(new Error(`ffprobe spawn error: ${err.message}`)))
    })
  }

  /** Detect available hardware encoders */
  detectHardwareAccel(): Promise<{ nvenc: boolean; qsv: boolean; amf: boolean }> {
    return new Promise((resolve) => {
      const proc = spawn(this.ffmpegPath, ['-encoders'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let stdout = ''
      const decoder = new StringDecoder('utf8')
      proc.stdout?.on('data', (data: Buffer) => { stdout += decoder.write(data) })
      proc.on('close', () => {
        resolve({
          nvenc: /h264_nvenc/.test(stdout),
          qsv: /h264_qsv/.test(stdout),
          amf: /h264_amf/.test(stdout)
        })
      })
      proc.on('error', () => resolve({ nvenc: false, qsv: false, amf: false }))
    })
  }

  /** Extract a single frame at given timestamp as base64 PNG */
  extractFrame(filePath: string, frameMs: number, width = 160): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeSec = frameMs / 1000
      const args = [
        '-ss', timeSec.toString(), '-i', filePath,
        '-vframes', '1', '-vf', `scale=${width}:-1`,
        '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'
      ]

      const ffmpegProcess = spawn(this.ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })

      const chunks: Buffer[] = []
      let stderr = ''
      const errDecoder = new StringDecoder('utf8')

      ffmpegProcess.stdout?.on('data', (data: Buffer) => { chunks.push(data) })
      ffmpegProcess.stderr?.on('data', (data: Buffer) => { stderr = appendCappedStderr(stderr, errDecoder.write(data)) })

      ffmpegProcess.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks).toString('base64'))
        } else {
          reject(new Error(`Frame extraction failed: ${FFmpegService.formatStderrMessage(stderr)}`))
        }
      })

      ffmpegProcess.on('error', (err) => reject(new Error(`Frame extraction spawn error: ${err.message}`)))
    })
  }

  /** Concatenate multiple video clips */
  concatClips(
    clipPaths: string[], outputPath: string,
    totalDurationMs: number, onProgress?: ProgressCallback
  ): { process: ChildProcess; promise: Promise<void> } {
    const inputs: string[] = []
    const filterParts: string[] = []

    clipPaths.forEach((path, i) => {
      inputs.push('-i', path)
      filterParts.push(`[${i}:v:0][${i}:a:0]`)
    })

    const filterComplex = `${filterParts.join('')}concat=n=${clipPaths.length}:v=1:a=1[outv][outa]`
    const args = [
      ...inputs, '-filter_complex', filterComplex,
      '-map', '[outv]', '-map', '[outa]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-y', outputPath
    ]

    return this.spawn(args, totalDurationMs, onProgress)
  }

  /** Build full export command with all filters */
  buildExportCommand(params: {
    clipPaths: string[]
    clipTrackIndices: number[]
    clipHasAudio?: boolean[]
    /** Whether each clip is effectively hidden (hidden track or solo exclusion). Hidden clips are skipped entirely. */
    clipHidden?: boolean[]
    /** Whether each clip's native audio should be muted (clip mute OR video track mute). */
    clipVideoMuted?: boolean[]
    /** Video fade-in duration per clip in ms (0 = no fade). Applied to video stream. */
    clipFadeInMs?: number[]
    /** Video fade-out duration per clip in ms (0 = no fade). Applied to video stream. */
    clipFadeOutMs?: number[]
    clipTransforms: Array<ClipTransformExport | null>
    clipVolumes?: Array<{ volume: number; muted: boolean }>
    clipStartMs?: number[]
    clipDurationMs?: number[]
    clipTrimStarts?: number[]
    clipSpeeds?: number[]
    // Phase 7 (shared export graph): per-clip effect/modifier filters
    // (static, stack order), keyframe-baked animated filters (clip-local ms),
    // animated opacity segments (0-1 values, clip-local ms), ffmpeg blend
    // mode name (null = normal overlay path), and resolved transition fade
    // windows. All produced by buildExportGraph — this function only applies.
    clipVideoFilters?: string[][]
    clipVideoAnimated?: ExportAnimatedFilter[][]
    clipAnimatedOpacity?: ExportTimeSegment[][]
    clipAnimatedVolume?: ExportTimeSegment[][]
    clipBlends?: (string | null)[]
    clipTransitionFadeInMs?: number[]
    clipTransitionFadeOutMs?: number[]
    /** Geometric slide offsets (overlay x/y expressions), from the graph. */
    clipSlideOut?: (SlideGeometry | null)[]
    clipSlideIn?: (SlideGeometry | null)[]
    /** Geometric zoom scales (scale eval=frame), from the graph. */
    clipZoomOut?: (ZoomGeometry | null)[]
    clipZoomIn?: (ZoomGeometry | null)[]
    // Phase 7 ignored-knob wiring: range trims output, audioOnly drops the
    // video graph, bitrate overrides CRF, useNvenc selects h264_nvenc.
    exportFrameRange?: { startMs: number; endMs: number } | null
    audioOnly?: boolean
    bitrateKbps?: number | null
    bitrateMode?: 'auto' | 'cbr' | 'vbr'
    useNvenc?: boolean
    audioTracks: Array<{ path: string; startMs: number; volume: number; trimStart?: number; durationMs?: number; fadeInMs?: number; fadeOutMs?: number }>
    audioAnimatedVolume?: ExportTimeSegment[][]
    srtPath: string | null
    captionStyle: ExportCaptionStyle | null
    outputWidth: number; outputHeight: number
    projectWidth: number; projectHeight: number
    fps?: number
    codec: 'h264' | 'h265' | 'prores' | 'vp9'
    qualityPreset: 'fast' | 'slow'
    outputPath: string
    totalDurationMs?: number
  }): string[] {
    const {
      clipPaths, clipTrackIndices, clipHasAudio, clipHidden, clipVideoMuted,
      clipTransforms, clipVolumes,
      clipStartMs, clipDurationMs, clipTrimStarts, clipSpeeds,
      clipVideoFilters, clipVideoAnimated, clipAnimatedOpacity, clipAnimatedVolume,
      clipBlends, clipTransitionFadeInMs, clipTransitionFadeOutMs,
      clipSlideOut, clipSlideIn, clipZoomOut, clipZoomIn,
      exportFrameRange, audioOnly, bitrateKbps, bitrateMode, useNvenc,
      audioTracks, audioAnimatedVolume, srtPath, captionStyle, outputWidth, outputHeight,
      projectWidth, projectHeight, fps, codec, qualityPreset, outputPath
    } = params

    // projectWidth/projectHeight used for clip X/Y position scaling below
    const pW = projectWidth > 0 ? projectWidth : outputWidth
    const pH = projectHeight > 0 ? projectHeight : outputHeight

    // Sort clips by trackIndex ascending (track 0 at bottom, highest on top)
    const clipOrder = clipPaths.map((_, i) => i).sort((a, b) => clipTrackIndices[a] - clipTrackIndices[b])

    const args: string[] = []
    const filterParts: string[] = []
    const audioMapArgs: string[] = []

    clipPaths.forEach((path) => args.push('-i', path))
    audioTracks.forEach((track) => args.push('-i', track.path))

    // 1. Base video background (black, matches output resolution, fits totalDurationMs)
    // RGBA throughout the composite chain: the `blend` path (non-normal blend
    // modes) requires identical pixel formats on both inputs.
    const totalDurationMs = Math.max(1, params.totalDurationMs ?? 0)
    const durationSec = (totalDurationMs / 1000).toFixed(3)
    if (!audioOnly) {
      filterParts.push(`color=c=black:s=${outputWidth}x${outputHeight}:d=${durationSec},format=rgba[base]`)
    }

    const isIdentity = (t: ClipTransformExport | null): boolean =>
      !t || (t.x === 0 && t.y === 0 && t.scaleX === 1 && t.scaleY === 1
        && t.rotation === 0 && t.opacity === 1
        && t.cropTop === 0 && t.cropBottom === 0 && t.cropLeft === 0 && t.cropRight === 0)

    // Build per-clip filters (trim, speed, delay/setpts, crop, scale, rotate,
    // opacity, EFFECT FILTERS from the shared export graph, fades, pad).
    // Hidden clips are skipped entirely — they contribute neither video nor audio to the output.
    // audioOnly skips the whole video chain (no base, no overlays, -vn below).
    if (!audioOnly) {
    clipOrder.forEach((origIdx) => {
      if (clipHidden?.[origIdx]) return  // hidden track — skip video

      const t = clipTransforms[origIdx]
      const startMs = clipStartMs?.[origIdx] ?? 0
      const durationMs = clipDurationMs?.[origIdx] ?? totalDurationMs
      const trimStart = clipTrimStarts?.[origIdx] ?? 0
      const speedVal = Math.max(0.01, clipSpeeds?.[origIdx] ?? 1.0)  // guard zero/negative
      const fadeInMs = params.clipFadeInMs?.[origIdx] ?? 0
      const fadeOutMs = params.clipFadeOutMs?.[origIdx] ?? 0
      const transInMs = clipTransitionFadeInMs?.[origIdx] ?? 0
      const transOutMs = clipTransitionFadeOutMs?.[origIdx] ?? 0

      const delaySec = (startMs / 1000).toFixed(3)
      const trimStartSec = (trimStart / 1000).toFixed(3)
      const durationSecVal = (durationMs / 1000).toFixed(3)

      const parts: string[] = []

      // Trim & Speed & delay timestamp shifting (video stream level).
      // setpts shifts PTS onto the ABSOLUTE timeline, so every `st=` and
      // `enable` window below is absolute ms — matching Preview, where a
      // fade/keyframe runs relative to the clip's timeline position, not
      // relative to its own first frame.
      const ptsExpr = `(PTS-STARTPTS)/${speedVal}+${delaySec}/TB`
      parts.push(`trim=start=${trimStartSec}:duration=${durationSecVal},setpts=${ptsExpr}`)

      if (!isIdentity(t) && t) {
        // Apply crop
        if (t.cropTop || t.cropBottom || t.cropLeft || t.cropRight) {
          parts.push(`crop=iw*(1-${t.cropLeft + t.cropRight}):ih*(1-${t.cropTop + t.cropBottom}):iw*${t.cropLeft}:ih*${t.cropTop}`)
        }
        // Scale
        if (t.scaleX !== 1 || t.scaleY !== 1) {
          parts.push(`scale=iw*${t.scaleX}:ih*${t.scaleY}`)
        }
        // Rotation (pad to avoid clipping)
        if (t.rotation !== 0) {
          const rad = (t.rotation * Math.PI) / 180
          parts.push(`rotate=${rad.toFixed(6)}:fillcolor=none:ow=rotw(${rad.toFixed(6)}):oh=roth(${rad.toFixed(6)})`)
        }
      }

      // Opacity: keyframe-baked segments win over the static value (segments
      // always cover the full clip range by construction).
      const animOp = clipAnimatedOpacity?.[origIdx] ?? []
      if (animOp.length > 0) {
        parts.push('format=rgba')
        for (const seg of animOp) {
          parts.push(withEnableWindow(
            `colorchannelmixer=aa=${fmtFilterNumber(seg.value)}`,
            startMs + seg.startMs,
            startMs + seg.endMs
          ))
        }
      } else if (!isIdentity(t) && t && t.opacity < 1) {
        parts.push(`format=rgba,colorchannelmixer=aa=${t.opacity.toFixed(3)}`)
      }

      // Phase 7: static effect filters from the shared export graph, in
      // modifier-stack order (same order as Preview's CSS join).
      for (const f of clipVideoFilters?.[origIdx] ?? []) {
        parts.push(f)
      }
      // Phase 7: keyframe-baked effect segments (clip-local -> absolute).
      for (const seg of clipVideoAnimated?.[origIdx] ?? []) {
        parts.push(withEnableWindow(seg.filter, startMs + seg.startMs, startMs + seg.endMs))
      }

      // Video fade in/out — ABSOLUTE st. (Previously st=0 relative, which
      // silently no-op'd every fade on clips starting after t=0 while
      // Preview showed them. Clips at t=0 emit byte-identical args.)
      if (fadeInMs > 0) {
        parts.push(`fade=t=in:st=${(startMs / 1000).toFixed(3)}:d=${(fadeInMs / 1000).toFixed(3)}:alpha=1`)
      }
      if (fadeOutMs > 0) {
        const fadeOutStartSec = Math.max(0, (startMs + durationMs - fadeOutMs) / 1000)
        parts.push(`fade=t=out:st=${fadeOutStartSec.toFixed(3)}:d=${(fadeOutMs / 1000).toFixed(3)}:alpha=1`)
      }
      // Phase 7: resolved transition crossfade/dip windows (absolute).
      if (transInMs > 0) {
        parts.push(`fade=t=in:st=${(startMs / 1000).toFixed(3)}:d=${(transInMs / 1000).toFixed(3)}:alpha=1`)
      }
      if (transOutMs > 0) {
        const transOutStartSec = Math.max(0, (startMs + durationMs - transOutMs) / 1000)
        parts.push(`fade=t=out:st=${transOutStartSec.toFixed(3)}:d=${(transOutMs / 1000).toFixed(3)}:alpha=1`)
      }

      // Pad with transparent background for compositing/overlays
      parts.push('format=rgba')
      parts.push(`scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease`)
      parts.push(`pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=black@0`)

      // Zoom transition: time-varying scale on the padded frame (centered by
      // the overlay below). Preview parity: zoom-in/out scale + full fade.
      const zoomGeom = (clipZoomIn?.[origIdx] ?? clipZoomOut?.[origIdx]) ?? null
      if (zoomGeom) {
        const z = zoomScaleExpr(zoomGeom, startMs)
        parts.push(`scale=w='trunc(iw*(${z})/2)*2':h='trunc(ih*(${z})/2)*2':eval=frame`)
      }

      filterParts.push(`[${origIdx}:v]${parts.join(',')}[vs${origIdx}]`)
    })
    }

    // Overlay compositions — apply actual X/Y transform offsets.
    // Hidden clips are excluded from overlay chain. Clips with a non-normal
    // blend mode take the `blend` path (per-plane modes, alpha passthrough —
    // matches CSS mix-blend-mode compositing); everything else uses `overlay`.
    let videoFilter = '[base]'
    if (!audioOnly) {
    clipOrder.forEach((origIdx, idx) => {
      if (clipHidden?.[origIdx]) return  // hidden — skip overlay

      const t = clipTransforms[origIdx]
      const startMs = clipStartMs?.[origIdx] ?? 0
      const durationMs = clipDurationMs?.[origIdx] ?? totalDurationMs
      const delaySec = (startMs / 1000).toFixed(3)
      const endSec = ((startMs + durationMs) / 1000).toFixed(3)

      // Zoom transition: the padded frame is scaled about its center, so the
      // overlay below is centered (x=(W-w)/2) rather than top-left aligned.
      const zoom = (clipZoomIn?.[origIdx] ?? clipZoomOut?.[origIdx]) ?? null

      let overlayX = zoom ? '(W-w)/2' : '0'
      let overlayY = zoom ? '(H-h)/2' : '0'
      if (t && (t.x !== 0 || t.y !== 0)) {
        const xPx = Math.round((t.x / pW) * outputWidth)
        const yPx = Math.round((t.y / pH) * outputHeight)
        overlayX = zoom ? `${overlayX}+${xPx}` : xPx.toString()
        overlayY = zoom ? `${overlayY}+${yPx}` : yPx.toString()
      }

      // Geometric slide transitions: animate the overlay coordinate.
      const slideOut = clipSlideOut?.[origIdx] ?? null
      const slideIn = clipSlideIn?.[origIdx] ?? null
      const hasSlide = slideOut !== null || slideIn !== null
      for (const geom of [slideOut, slideIn]) {
        if (!geom) continue
        if (geom.axis === 'x') {
          overlayX = slideOffsetExpr(geom, overlayX, startMs, outputWidth)
        } else {
          overlayY = slideOffsetExpr(geom, overlayY, startMs, outputHeight)
        }
      }

      const nextFilter = `[v_over_${idx}]`
      // Use gte(t,start)*lt(t,end) instead of between() to get exclusive upper bound.
      // between(t,a,b) is inclusive on both ends — at a hard cut where clip A ends at t=5.0
      // and clip B starts at t=5.0, both would render for one frame. gte/lt avoids that.
      const blend = clipBlends?.[origIdx] ?? null
      if (blend) {
        filterParts.push(`${videoFilter}[vs${origIdx}]blend=c0_mode=${blend}:c1_mode=${blend}:c2_mode=${blend}:c3_mode=normal:all_opacity=1:enable='gte(t,${delaySec})*lt(t,${endSec})':eof_action=pass${nextFilter}`)
      } else {
        const overlayXY = hasSlide
          ? `x='${overlayX}':y='${overlayY}'`
          : `x=${overlayX}:y=${overlayY}`
        filterParts.push(`${videoFilter}[vs${origIdx}]overlay=${overlayXY}:enable='gte(t,${delaySec})*lt(t,${endSec})':eof_action=pass${nextFilter}`)
      }
      videoFilter = nextFilter
    })
    }

    // Rename to composited
    if (!audioOnly) {
      filterParts.push(`${videoFilter}null[composited]`)
      videoFilter = '[composited]'
    }

    // Burn-in subtitles/captions (video path only)
    if (srtPath && captionStyle && !audioOnly) {
      const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
      const isAssFile = /\.ass$/i.test(srtPath)
      const fontsDir = FFmpegService.getFontsDir()
      if (!fontsDir) {
        console.warn('[export] fonts directory not found — subtitle fonts may fall back to system fonts')
      }
      const fontsDirOption = fontsDir ? `:fontsdir='${FFmpegService.escapeFilterPath(fontsDir)}'` : ''

      let subtitlesFilter: string
      if (isAssFile) {
        // ASS file carries all per-clip style, margins, and animations — no extra args needed
        subtitlesFilter = `${videoFilter}subtitles='${escapedSrtPath}'${fontsDirOption}[captioned]`
      } else {
        // SRT fallback: burn with a single global style derived from captionStyle
        // (used only when createTempASS IPC is unavailable; ASS is always preferred)
        const scale = captionStyle.scale ?? 1
        const fontSize = Math.round(captionStyle.fontSize * (outputHeight / 1080) * scale)
        const fColor = captionStyle.color ?? '#ffffff'
        const fontColor = toAssColor(fColor)
        const bgColor = toAssColor(captionStyle.bgColor, captionStyle.bgOpacity ?? 0.5)
        const strokeColor = toAssColor(captionStyle.strokeColor ?? '#000000')
        const fontWeight = (captionStyle.fontWeight ?? 500) >= 700 ? '1' : '0'
        const outlineWidth = Math.max(1, Math.round((captionStyle.strokeWidth ?? 0) * (outputHeight / 1080) * scale))
        subtitlesFilter = `${videoFilter}subtitles='${escapedSrtPath}'${fontsDirOption}:force_style='PlayResX=${outputWidth},PlayResY=${outputHeight},ScaledBorderAndShadow=yes,FontName=${captionStyle.fontFamily},FontSize=${fontSize},Bold=${fontWeight},PrimaryColour=${fontColor},BackColour=${bgColor},OutlineColour=${strokeColor},Outline=${outlineWidth},Shadow=0,Alignment=2,MarginV=50'[captioned]`
      }

      filterParts.push(subtitlesFilter)
      videoFilter = '[captioned]'
    }

    if (fps && fps > 0 && !audioOnly) {
      filterParts.push(`${videoFilter}fps=${fps}[vout]`)
      videoFilter = '[vout]'
    }

    // Audio mixing — apply per-clip trim/speed/volume/mute/fade for native video audio, plus audioTracks.
    // clipHidden: excluded entirely. clipVideoMuted: covers clip.muted AND video track mute.
    const audioInputs: string[] = []
    clipPaths.forEach((_, i) => {
      const cv = clipVolumes?.[i]

      // Skip: hidden, no audio stream, muted by video track/clip mute, or effectively silent
      if (
        clipHidden?.[i] ||
        clipHasAudio?.[i] === false ||
        clipVideoMuted?.[i] ||
        (cv?.volume ?? 1) === 0
      ) return

      const startMs = clipStartMs?.[i] ?? 0
      const durationMs = clipDurationMs?.[i] ?? totalDurationMs
      const trimStart = clipTrimStarts?.[i] ?? 0
      const speedVal = Math.max(0.01, clipSpeeds?.[i] ?? 1.0)  // guard zero/negative speed
      const fadeInMs = params.clipFadeInMs?.[i] ?? 0
      const fadeOutMs = params.clipFadeOutMs?.[i] ?? 0

      const delayMs = Math.max(0, Math.round(startMs))
      const durationSecVal = (durationMs / 1000).toFixed(3)
      const trimStartSec = (trimStart / 1000).toFixed(3)

      // Build atempo chain — atempo only accepts [0.5, 2.0] per filter, so chain multiples
      const atempoFilters: string[] = []
      let tempSpeed = speedVal
      while (tempSpeed > 2.0) { atempoFilters.push('atempo=2.0'); tempSpeed /= 2.0 }
      while (tempSpeed < 0.5) { atempoFilters.push('atempo=0.5'); tempSpeed *= 2.0 }
      if (Math.abs(tempSpeed - 1.0) > 0.001) atempoFilters.push(`atempo=${tempSpeed.toFixed(3)}`)
      const atempoStr = atempoFilters.length > 0 ? `,${atempoFilters.join(',')}` : ''

      const audioVol = cv?.volume ?? 1
      // Phase 7: keyframed volume automation wins over the static value
      // (segments always cover the full clip range by construction).
      const animVol = clipAnimatedVolume?.[i] ?? []
      const volStr = animVol.length > 0 ? '' : audioVol !== 1 ? `,volume=${audioVol.toFixed(3)}` : ''

      // Audio fade in/out — applied after speed and volume
      let fadeStr = ''
      if (fadeInMs > 0) {
        fadeStr += `,afade=t=in:st=0:d=${(fadeInMs / 1000).toFixed(3)}`
      }
      if (fadeOutMs > 0) {
        const fadeOutStartSec = Math.max(0, (durationMs - fadeOutMs) / 1000)
        fadeStr += `,afade=t=out:st=${fadeOutStartSec.toFixed(3)}:d=${(fadeOutMs / 1000).toFixed(3)}`
      }

      // Phase 7: baked volume automation on the ABSOLUTE timeline.
      let animVolStr = ''
      for (const seg of animVol) {
        animVolStr += `,${withEnableWindow(`volume=${fmtFilterNumber(seg.value)}`, startMs + seg.startMs, startMs + seg.endMs)}`
      }

      filterParts.push(`[${i}:a:0]${AUDIO_NORM_FILTER},atrim=start=${trimStartSec}:duration=${durationSecVal}${atempoStr},adelay=${delayMs}|${delayMs}${volStr}${fadeStr}${animVolStr}[ac${i}]`)
      audioInputs.push(`[ac${i}]`)
    })

    // External audio tracks (SFX/music from timeline) — apply trim, delay, volume, fade
    audioTracks.forEach((track, i) => {
      const inputIdx = clipPaths.length + i
      const delayMs = Math.max(0, Math.round(track.startMs ?? 0))
      const trimStartSec = ((track.trimStart ?? 0) / 1000).toFixed(3)
      const vol = (track.volume ?? 1).toFixed(3)
      // req 2.6 — clamp unbounded atrim when durationMs missing or zero
      const effectiveDurationMs =
        track.durationMs && track.durationMs > 0
          ? track.durationMs
          : Math.max(0, totalDurationMs - delayMs)
      const durSec = (effectiveDurationMs / 1000).toFixed(3)

      // Audio fade in/out for external tracks
      let fadeStr = ''
      const trackFadeIn = track.fadeInMs ?? 0
      const trackFadeOut = track.fadeOutMs ?? 0
      if (trackFadeIn > 0) {
        fadeStr += `,afade=t=in:st=0:d=${(trackFadeIn / 1000).toFixed(3)}`
      }
      if (trackFadeOut > 0 && effectiveDurationMs > 0) {
        const fadeOutStartSec = Math.max(0, (effectiveDurationMs - trackFadeOut) / 1000)
        fadeStr += `,afade=t=out:st=${fadeOutStartSec.toFixed(3)}:d=${(trackFadeOut / 1000).toFixed(3)}`
      }

      // Phase 7: baked volume automation (absolute timeline); wins over static.
      const animVol = audioAnimatedVolume?.[i] ?? []
      const volPart = animVol.length > 0 ? '' : `,volume=${vol}`
      let animVolStr = ''
      for (const seg of animVol) {
        animVolStr += `,${withEnableWindow(`volume=${fmtFilterNumber(seg.value)}`, delayMs + seg.startMs, delayMs + seg.endMs)}`
      }

      filterParts.push(
        `[${inputIdx}:a:0]${AUDIO_NORM_FILTER},atrim=start=${trimStartSec}:duration=${durSec},adelay=${delayMs}|${delayMs}${volPart}${fadeStr}${animVolStr}[av${i}]`
      )
      audioInputs.push(`[av${i}]`)
    })

    if (audioInputs.length > 1) {
      filterParts.push(`${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=2[aout]`)
      audioMapArgs.push('-map', '[aout]')
    } else if (audioInputs.length === 1) {
      // Single processed audio stream — it's always a named filter label like [ac0] or [av0]
      audioMapArgs.push('-map', audioInputs[0])
    } else {
      audioMapArgs.push('-an')
    }

    if (filterParts.length > 0) args.push('-filter_complex', filterParts.join(';'))
    if (audioOnly) {
      // Audio-only export: no video stream at all (UI knob was previously
      // forwarded but ignored — the file came out with video anyway).
      args.push('-vn')
    } else {
      args.push('-map', videoFilter)
    }
    args.push(...audioMapArgs)

    const hasAudioOutput = audioInputs.length > 0
    // Phase 7: explicit bitrate wins over CRF. CBR pins min/max/bufsize;
    // VBR/auto sets target + ceiling and keeps encoder quality logic.
    const hasBitrate = typeof bitrateKbps === 'number' && bitrateKbps > 0
    const bitrateStr = hasBitrate ? `${Math.round(bitrateKbps as number)}k` : null
    const useHwAccel = useNvenc === true && codec === 'h264'

    switch (codec) {
      case 'h264':
        if (useHwAccel) {
          args.push('-c:v', 'h264_nvenc', '-preset', qualityPreset === 'fast' ? 'p4' : 'p7')
          if (bitrateStr) {
            args.push('-b:v', bitrateStr)
            if (bitrateMode === 'cbr') args.push('-minrate', bitrateStr, '-maxrate', bitrateStr, '-bufsize', `${Math.round((bitrateKbps as number) * 2)}k`)
          } else {
            args.push('-cq', qualityPreset === 'fast' ? '23' : '20')
          }
        } else {
          args.push('-c:v', 'libx264', '-preset', qualityPreset)
          if (bitrateStr) {
            args.push('-b:v', bitrateStr)
            if (bitrateMode === 'cbr') args.push('-minrate', bitrateStr, '-maxrate', bitrateStr, '-bufsize', `${Math.round((bitrateKbps as number) * 2)}k`)
          } else {
            args.push('-crf', String(CRF_H264[qualityPreset]))
          }
        }
        if (hasAudioOutput) args.push('-c:a', 'aac', '-b:a', qualityPreset === 'fast' ? '160k' : '192k')
        // req 2.13 + 2.14 + 2.15
        if (!audioOnly) args.push('-pix_fmt', 'yuv420p', '-color_range', 'tv', '-fps_mode', 'cfr')
        break
      case 'h265':
        args.push('-c:v', 'libx265', '-preset', qualityPreset)
        if (bitrateStr) {
          args.push('-b:v', bitrateStr)
          if (bitrateMode === 'cbr') args.push('-minrate', bitrateStr, '-maxrate', bitrateStr, '-bufsize', `${Math.round((bitrateKbps as number) * 2)}k`)
        } else {
          args.push('-crf', String(CRF_H265[qualityPreset]))
        }
        if (hasAudioOutput) args.push('-c:a', 'aac', '-b:a', '192k')
        if (!audioOnly) args.push('-pix_fmt', 'yuv420p10le', '-color_range', 'tv', '-fps_mode', 'cfr')
        break
      case 'prores':
        args.push('-c:v', 'prores_ks', '-profile:v', '3')
        if (hasAudioOutput) args.push('-c:a', 'pcm_s16le')
        break
      case 'vp9':
        args.push('-c:v', 'libvpx-vp9', '-b:v', bitrateStr ?? '0')
        if (!bitrateStr) args.push('-crf', String(CRF_VP9[qualityPreset]))
        if (hasAudioOutput) args.push('-c:a', 'libopus', '-b:a', qualityPreset === 'fast' ? '128k' : '192k')
        if (!audioOnly) args.push('-pix_fmt', 'yuv420p', '-color_range', 'tv', '-fps_mode', 'cfr')
        break
    }

    // Phase 7: frame-range export trims the muxed output (absolute timeline
    // graph is unchanged; -ss/-t as OUTPUT options seek/trim the result).
    if (exportFrameRange && exportFrameRange.endMs > exportFrameRange.startMs) {
      args.push('-ss', (Math.max(0, exportFrameRange.startMs) / 1000).toFixed(3))
      args.push('-t', ((exportFrameRange.endMs - exportFrameRange.startMs) / 1000).toFixed(3))
    } else {
      // Limit output duration exactly to project duration and write to output file
      args.push('-t', (totalDurationMs / 1000).toFixed(3))
    }
    if (!audioOnly) args.push('-movflags', '+faststart')
    args.push('-y', outputPath)
    return args
  }

  /** Upscale video using lanczos/bicubic filter */
  upscaleVideo(
    inputPath: string, outputPath: string,
    targetWidth: number, targetHeight: number,
    algorithm: 'lanczos' | 'bicubic' = 'lanczos',
    codec: 'h264' | 'h265' | 'prores' | 'vp9' = 'h264',
    qualityPreset: 'fast' | 'slow' = 'slow',
    totalDurationMs = 0, onProgress?: ProgressCallback
  ): { process: ChildProcess; promise: Promise<void> } {
    const args = [
      '-i', inputPath,
      '-vf', `scale=${targetWidth}:${targetHeight}:flags=${algorithm}`,
    ]

    switch (codec) {
      case 'h264':
        args.push('-c:v', 'libx264', '-preset', qualityPreset, '-crf', '18')
        args.push('-c:a', 'copy')
        break
      case 'h265':
        args.push('-c:v', 'libx265', '-preset', qualityPreset, '-crf', '18')
        args.push('-c:a', 'copy')
        break
      case 'prores':
        args.push('-c:v', 'prores_ks', '-profile:v', '3', '-c:a', 'copy')
        break
      case 'vp9':
        args.push('-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-c:a', 'copy')
        break
    }

    args.push('-y', outputPath)
    return this.spawn(args, totalDurationMs, onProgress)
  }

  /** req 2.19 — Post-export validation via ffprobe */
  async probeExportOutput(outputPath: string): Promise<ExportProbeResult> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        outputPath
      ]
      const proc = spawn(this.ffprobePath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let stdout = ''
      let stderr = ''
      const decoder = new StringDecoder('utf8')
      const errDecoder = new StringDecoder('utf8')
      proc.stdout?.on('data', (d: Buffer) => { stdout += decoder.write(d) })
      proc.stderr?.on('data', (d: Buffer) => { stderr = appendCappedStderr(stderr, errDecoder.write(d)) })
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe failed (${code}): ${FFmpegService.formatStderrMessage(stderr)}`))
          return
        }
        try {
          const parsed = JSON.parse(stdout) as {
            streams?: Array<{ codec_type?: string; width?: number; height?: number }>
            format?: { duration?: string }
          }
          const video = parsed.streams?.find((s) => s.codec_type === 'video')
          const audio = parsed.streams?.find((s) => s.codec_type === 'audio')
          const durationSec = parseFloat(parsed.format?.duration ?? '0')
          resolve({
            width: video?.width ?? 0,
            height: video?.height ?? 0,
            durationMs: Math.round(durationSec * 1000),
            hasVideo: !!video,
            hasAudio: !!audio
          })
        } catch (err) {
          reject(new Error(`ffprobe JSON parse failed: ${(err as Error).message}`))
        }
      })
      proc.on('error', (err) => reject(err))
    })
  }

  /** req 2.19 — Assert export output matches expected dimensions and duration */
  async validateExportOutput(
    outputPath: string,
    expected: { width: number; height: number; totalDurationMs: number; expectAudio: boolean; expectVideo?: boolean }
  ): Promise<void> {
    const probe = await this.probeExportOutput(outputPath)
    if (expected.expectVideo !== false && !probe.hasVideo) {
      throw new Error('Post-export validation failed: no video stream in output')
    }
    if (expected.expectVideo !== false && (probe.width !== expected.width || probe.height !== expected.height)) {
      throw new Error(
        `Post-export validation failed: expected ${expected.width}x${expected.height}, got ${probe.width}x${probe.height}`
      )
    }
    if (Math.abs(probe.durationMs - expected.totalDurationMs) > 500) {
      throw new Error(
        `Post-export validation failed: duration ${probe.durationMs}ms vs expected ${expected.totalDurationMs}ms`
      )
    }
    if (expected.expectAudio && !probe.hasAudio) {
      throw new Error('Post-export validation failed: expected audio stream but output has none')
    }
  }

  /**
   * Extract audio from video file to temporary WAV.
   * When totalDurationMs is provided, uses real FFmpeg stderr progress parsing.
   * Otherwise falls back to time-based estimation.
   */
  async extractAudio(
    videoPath: string,
    outputPath?: string,
    onProgress?: (percent: number) => void,
    totalDurationMs?: number
  ): Promise<string> {
    const output = outputPath || join(tmpdir(), `audio_${randomUUID()}.wav`)
    
    return new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-vn', // No video
        '-acodec', 'pcm_s16le', // PCM WAV
        '-ar', '16000', // 16kHz for Whisper
        '-ac', '1', // Mono
        '-progress', 'pipe:1', // Machine-parseable progress to stdout
        '-y', output
      ]

      const ffmpegProcess = spawn(this.ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      this.lastExtractionProcess = ffmpegProcess

      let stderr = ''
      const errDecoder = new StringDecoder('utf8')

      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const line = errDecoder.write(data)
        stderr = appendCappedStderr(stderr, line)
        if (onProgress && totalDurationMs && totalDurationMs > 0) {
          const parsed = FFmpegService.parseProgress(line, totalDurationMs)
          if (parsed) {
            onProgress(Math.min(99, Math.round(parsed.percent)))
          }
        }
      })

      // Fallback: simulated progress when no duration is available
      let progressInterval: ReturnType<typeof setInterval> | null = null
      if (onProgress && (!totalDurationMs || totalDurationMs <= 0)) {
        const startTime = Date.now()
        progressInterval = setInterval(() => {
          const elapsed = Date.now() - startTime
          const percent = Math.min(90, (elapsed / 1000) * 30)
          onProgress(percent)
        }, 100)
      }

      ffmpegProcess.on('close', (code) => {
        if (progressInterval) clearInterval(progressInterval)
        if (code === 0) {
          onProgress?.(100)
          resolve(output)
        } else {
          reject(new Error(`FFmpeg audio extraction failed with code ${code}: ${FFmpegService.formatStderrMessage(stderr)}`))
        }
      })

      ffmpegProcess.on('error', (err) => {
        if (progressInterval) clearInterval(progressInterval)
        reject(new Error(`FFmpeg spawn error: ${err.message}`))
      })
    })
  }

  /**
   * Mix multiple audio sources with time-offset alignment for timeline transcription.
   * Uses FFmpeg adelay + amix to position each source at its correct timeline offset.
   * Example: clip A at 5s, clip B at 15s → adelay=5000|5000 for A, adelay=15000|15000 for B.
   */
  async mixTimelineAudioWithOffsets(
    sources: Array<{ path: string; startMs: number; durationMs: number }>,
    outputPath?: string,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    if (sources.length === 0) {
      throw new Error('No sources provided')
    }

    if (sources.length === 1) {
      return this.extractAudio(sources[0].path, outputPath, onProgress)
    }

    const output = outputPath || join(tmpdir(), `mixed_audio_${randomUUID()}.wav`)

    // Build FFmpeg filter complex with adelay for time alignment
    const inputs: string[] = []
    const filterParts: string[] = []

    sources.forEach((source, i) => {
      inputs.push('-i', source.path)
      // adelay: delay both channels by startMs milliseconds
      filterParts.push(`[${i}:a]adelay=${source.startMs}|${source.startMs}[a${i}]`)
    })

    const inputsList = sources.map((_, i) => `[a${i}]`).join('')
    const filterComplex = `${filterParts.join(';')};${inputsList}amix=inputs=${sources.length}:dropout_transition=2[aout]`

    const args = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[aout]',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-y', output
    ]

    return new Promise((resolve, reject) => {
      // Calculate total duration for real progress tracking
      const maxEndMs = Math.max(...sources.map((s) => s.startMs + s.durationMs))
      const { promise } = this.spawn(args, maxEndMs)

      const startTime = Date.now()
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime
        const percent = Math.min(90, (elapsed / 2000) * 30)
        onProgress?.(percent)
      }, 100)

      promise
        .then(() => {
          clearInterval(progressInterval)
          onProgress?.(100)
          resolve(output)
        })
        .catch(reject)
    })
  }

  /** Mix multiple audio files into a single temporary WAV */
  async mixAudioFiles(
    inputPaths: string[],
    outputPath?: string,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    if (inputPaths.length === 0) {
      throw new Error('No input files provided')
    }

    if (inputPaths.length === 1) {
      // Just extract audio from single file
      return this.extractAudio(inputPaths[0], outputPath, onProgress)
    }

    const output = outputPath || join(tmpdir(), `mixed_audio_${randomUUID()}.wav`)
    
    // Build FFmpeg complex filter for mixing
    const inputs: string[] = []
    const filterParts: string[] = []
    
    inputPaths.forEach((path, i) => {
      inputs.push('-i', path)
      filterParts.push(`[${i}:a]`)
    })

    const filterComplex = `${filterParts.join('')}amix=inputs=${inputPaths.length}:dropout_transition=0[aout]`

    const args = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[aout]',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-y', output
    ]

    return new Promise((resolve, reject) => {
      const { promise } = this.spawn(args, 0)

      const startTime = Date.now()
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime
        const percent = Math.min(90, (elapsed / 2000) * 30) // Assume ~2 seconds max
        onProgress?.(percent)
      }, 100)

      promise
        .then(() => {
          clearInterval(progressInterval)
          onProgress?.(100)
          resolve(output)
        })
        .catch(reject)
    })
  }

  /**
   * Generate a low-resolution proxy (proxy) file for smooth editing of large media.
   * Scales to fit within 1280x720 while preserving aspect ratio.
   * Uses H.264 fast preset for quick generation.
   *
   * Returns the output proxy path.
   */
  generateProxy(
    inputPath: string,
    outputPath: string,
    totalDurationMs = 0,
    onProgress?: ProgressCallback
  ): { process: ChildProcess; promise: Promise<void> } {
    // Scale to 720p max, preserving aspect ratio.
    // scale=-2:720 means: height=720, width=auto-rounded-to-even.
    // If source is already ≤720p, scale filter still runs but is near-instant.
    const args = [
      '-i', inputPath,
      '-vf', 'scale=-2:720:flags=fast_bilinear',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '96k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', outputPath
    ]
    return this.spawn(args, totalDurationMs, onProgress)
  }
}
