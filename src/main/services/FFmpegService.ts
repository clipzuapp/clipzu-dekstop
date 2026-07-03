import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { app } from 'electron'
import { toAssColor } from '../../shared/utils/color'
import type { ExportCaptionStyle } from '../../shared/utils/srt'

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
   * Backslashes become forward slashes; colons are escaped as \:
   * Single quotes are escaped as \' for safe embedding in filter options.
   */
  static escapeFilterPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
  }

  /** req 2.20 — Include head and tail of stderr in error messages */
  static formatStderrMessage(stderr: string): string {
    if (stderr.length <= 600) return stderr.trim()
    return `${stderr.slice(0, 300).trim()}...${stderr.slice(-300).trim()}`
  }

  /** req 2.18 — Classify common FFmpeg failure patterns */
  static classifyFfmpegError(stderr: string): string | null {
    const patterns = [
      /Stream specifier[^\n]*does not match[^\n]*/i,
      /Invalid option[^\n]*/i,
      /No such file or directory[^\n]*/i,
      /Error while opening encoder[^\n]*/i,
      /moov atom not found[^\n]*/i
    ]
    for (const pattern of patterns) {
      const match = stderr.match(pattern)
      if (match) return match[0].trim()
    }
    return null
  }

  static buildFfmpegError(code: number | null, stderr: string): Error {
    const classified = FFmpegService.classifyFfmpegError(stderr)
    const body = FFmpegService.formatStderrMessage(stderr)
    const prefix = classified ? `${classified}: ` : ''
    return new Error(`FFmpeg exited with code ${code}: ${prefix}${body}`)
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

      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const line = data.toString()
        stderr += line
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
    durationMs: number; width: number; height: number; fps: number; codec: string; hasAudio: boolean
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

      probeProcess.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
      probeProcess.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

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
            hasAudio: !!audioStream
          })
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${(e as Error).message}`))
        }
      })

      probeProcess.on('error', (err) => reject(new Error(`ffprobe spawn error: ${err.message}`)))
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

      ffmpegProcess.stdout?.on('data', (data: Buffer) => { chunks.push(data) })
      ffmpegProcess.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

      ffmpegProcess.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks).toString('base64'))
        } else {
          reject(new Error(`Frame extraction failed: ${stderr.slice(-200)}`))
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
    audioTracks: Array<{ path: string; startMs: number; volume: number; trimStart?: number; durationMs?: number; fadeInMs?: number; fadeOutMs?: number }>
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
      audioTracks, srtPath, captionStyle, outputWidth, outputHeight,
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
    const totalDurationMs = Math.max(1, params.totalDurationMs ?? 0)
    const durationSec = (totalDurationMs / 1000).toFixed(3)
    filterParts.push(`color=c=black:s=${outputWidth}x${outputHeight}:d=${durationSec}[base]`)

    const isIdentity = (t: ClipTransformExport | null): boolean =>
      !t || (t.x === 0 && t.y === 0 && t.scaleX === 1 && t.scaleY === 1
        && t.rotation === 0 && t.opacity === 1
        && t.cropTop === 0 && t.cropBottom === 0 && t.cropLeft === 0 && t.cropRight === 0)

    // Build per-clip filters (trim, speed, delay/setpts, crop, scale, rotate, opacity, pad, fade)
    // Hidden clips are skipped entirely — they contribute neither video nor audio to the output.
    clipOrder.forEach((origIdx) => {
      if (clipHidden?.[origIdx]) return  // hidden track — skip video

      const t = clipTransforms[origIdx]
      const startMs = clipStartMs?.[origIdx] ?? 0
      const durationMs = clipDurationMs?.[origIdx] ?? totalDurationMs
      const trimStart = clipTrimStarts?.[origIdx] ?? 0
      const speedVal = Math.max(0.01, clipSpeeds?.[origIdx] ?? 1.0)  // guard zero/negative
      const fadeInMs = params.clipFadeInMs?.[origIdx] ?? 0
      const fadeOutMs = params.clipFadeOutMs?.[origIdx] ?? 0

      const delaySec = (startMs / 1000).toFixed(3)
      const trimStartSec = (trimStart / 1000).toFixed(3)
      const durationSecVal = (durationMs / 1000).toFixed(3)

      const parts: string[] = []

      // Trim & Speed & delay timestamp shifting (video stream level)
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
        // Opacity via colorchannelmixer alpha
        if (t.opacity < 1) {
          parts.push(`format=rgba,colorchannelmixer=aa=${t.opacity.toFixed(3)}`)
        }
      }

      // Video fade in/out — applied AFTER transform, BEFORE pad so it works on content only
      if (fadeInMs > 0) {
        parts.push(`fade=t=in:st=0:d=${(fadeInMs / 1000).toFixed(3)}:alpha=1`)
      }
      if (fadeOutMs > 0) {
        const fadeOutStartSec = Math.max(0, (durationMs - fadeOutMs) / 1000)
        parts.push(`fade=t=out:st=${fadeOutStartSec.toFixed(3)}:d=${(fadeOutMs / 1000).toFixed(3)}:alpha=1`)
      }

      // Pad with transparent background for compositing/overlays
      parts.push('format=rgba')
      parts.push(`scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease`)
      parts.push(`pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=black@0`)

      filterParts.push(`[${origIdx}:v]${parts.join(',')}[vs${origIdx}]`)
    })

    // Overlay compositions — apply actual X/Y transform offsets
    // Hidden clips are excluded from overlay chain.
    let videoFilter = '[base]'
    clipOrder.forEach((origIdx, idx) => {
      if (clipHidden?.[origIdx]) return  // hidden — skip overlay

      const t = clipTransforms[origIdx]
      const startMs = clipStartMs?.[origIdx] ?? 0
      const durationMs = clipDurationMs?.[origIdx] ?? totalDurationMs
      const delaySec = (startMs / 1000).toFixed(3)
      const endSec = ((startMs + durationMs) / 1000).toFixed(3)

      let overlayX = '0'
      let overlayY = '0'
      if (t && (t.x !== 0 || t.y !== 0)) {
        const xPx = Math.round((t.x / pW) * outputWidth)
        const yPx = Math.round((t.y / pH) * outputHeight)
        overlayX = xPx.toString()
        overlayY = yPx.toString()
      }

      const nextFilter = `[v_over_${idx}]`
      // Use gte(t,start)*lt(t,end) instead of between() to get exclusive upper bound.
      // between(t,a,b) is inclusive on both ends — at a hard cut where clip A ends at t=5.0
      // and clip B starts at t=5.0, both would render for one frame. gte/lt avoids that.
      filterParts.push(`${videoFilter}[vs${origIdx}]overlay=x=${overlayX}:y=${overlayY}:enable='gte(t,${delaySec})*lt(t,${endSec})':eof_action=pass${nextFilter}`)
      videoFilter = nextFilter
    })

    // Rename to composited
    filterParts.push(`${videoFilter}null[composited]`)
    videoFilter = '[composited]'

    // Burn-in subtitles/captions
    if (srtPath && captionStyle) {
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
        const fColor = captionStyle.fontColor ?? captionStyle.color ?? '#ffffff'
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

    if (fps && fps > 0) {
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
      const volStr = audioVol !== 1 ? `,volume=${audioVol.toFixed(3)}` : ''

      // Audio fade in/out — applied after speed and volume
      let fadeStr = ''
      if (fadeInMs > 0) {
        fadeStr += `,afade=t=in:st=0:d=${(fadeInMs / 1000).toFixed(3)}`
      }
      if (fadeOutMs > 0) {
        const fadeOutStartSec = Math.max(0, (durationMs - fadeOutMs) / 1000)
        fadeStr += `,afade=t=out:st=${fadeOutStartSec.toFixed(3)}:d=${(fadeOutMs / 1000).toFixed(3)}`
      }

      filterParts.push(`[${i}:a:0]${AUDIO_NORM_FILTER},atrim=start=${trimStartSec}:duration=${durationSecVal}${atempoStr},adelay=${delayMs}|${delayMs}${volStr}${fadeStr}[ac${i}]`)
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

      filterParts.push(
        `[${inputIdx}:a:0]${AUDIO_NORM_FILTER},atrim=start=${trimStartSec}:duration=${durSec},adelay=${delayMs}|${delayMs},volume=${vol}${fadeStr}[av${i}]`
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
    args.push('-map', videoFilter)
    args.push(...audioMapArgs)

    const hasAudioOutput = audioInputs.length > 0

    switch (codec) {
      case 'h264':
        args.push('-c:v', 'libx264', '-preset', qualityPreset, '-crf', String(CRF_H264[qualityPreset]))
        if (hasAudioOutput) args.push('-c:a', 'aac', '-b:a', qualityPreset === 'fast' ? '160k' : '192k')
        // req 2.13 + 2.14 + 2.15
        args.push('-pix_fmt', 'yuv420p', '-color_range', 'tv', '-fps_mode', 'cfr')
        break
      case 'h265':
        args.push('-c:v', 'libx265', '-preset', qualityPreset, '-crf', String(CRF_H265[qualityPreset]))
        if (hasAudioOutput) args.push('-c:a', 'aac', '-b:a', '192k')
        args.push('-pix_fmt', 'yuv420p10le', '-color_range', 'tv', '-fps_mode', 'cfr')
        break
      case 'prores':
        args.push('-c:v', 'prores_ks', '-profile:v', '3')
        if (hasAudioOutput) args.push('-c:a', 'pcm_s16le')
        break
      case 'vp9':
        args.push('-c:v', 'libvpx-vp9', '-crf', String(CRF_VP9[qualityPreset]), '-b:v', '0')
        if (hasAudioOutput) args.push('-c:a', 'libopus', '-b:a', qualityPreset === 'fast' ? '128k' : '192k')
        args.push('-pix_fmt', 'yuv420p', '-color_range', 'tv', '-fps_mode', 'cfr')
        break
    }

    // Limit output duration exactly to project duration and write to output file
    args.push('-t', (totalDurationMs / 1000).toFixed(3))
    args.push('-movflags', '+faststart', '-y', outputPath)
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
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
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
    expected: { width: number; height: number; totalDurationMs: number; expectAudio: boolean }
  ): Promise<void> {
    const probe = await this.probeExportOutput(outputPath)
    if (!probe.hasVideo) {
      throw new Error('Post-export validation failed: no video stream in output')
    }
    if (probe.width !== expected.width || probe.height !== expected.height) {
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

      ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const line = data.toString()
        stderr += line
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
          reject(new Error(`FFmpeg audio extraction failed with code ${code}: ${stderr.slice(-500)}`))
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
}
