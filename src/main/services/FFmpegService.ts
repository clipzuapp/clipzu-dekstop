import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

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
        else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`))
      })

      ffmpegProcess.on('error', (err) => {
        reject(new Error(`FFmpeg spawn error: ${err.message}`))
      })
    })

    return { process: ffmpegProcess, promise }
  }

  /** Get media info via ffprobe */
  getMediaInfo(filePath: string): Promise<{
    durationMs: number; width: number; height: number; fps: number; codec: string
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
            codec: videoStream?.codec_name || audioStream?.codec_name || 'unknown'
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
    clipTransforms: Array<ClipTransformExport | null>
    audioTracks: Array<{ path: string; startMs: number; volume: number }>
    srtPath: string | null
    captionStyle: {
      fontFamily: string; fontSize: number; fontWeight: number
      fontColor: string; bgColor: string; bgOpacity: number
      strokeColor: string; strokeWidth: number
      x: number; y: number
      alignment: 'left' | 'center' | 'right'
      position: 'top' | 'center' | 'bottom'
    } | null
    outputWidth: number; outputHeight: number
    projectWidth: number; projectHeight: number
    codec: 'h264' | 'h265' | 'prores' | 'vp9'
    qualityPreset: 'fast' | 'slow'
    outputPath: string
  }): string[] {
    const {
      clipPaths, clipTrackIndices, clipTransforms, audioTracks,
      srtPath, captionStyle, outputWidth, outputHeight,
      projectWidth, projectHeight, codec, qualityPreset, outputPath
    } = params

    // Reserved: projectHeight for future aspect-ratio-aware marginV scaling
    void projectHeight
    // Sort clips by trackIndex ascending (track 0 at bottom, highest on top)
    const clipOrder = clipPaths.map((_, i) => i).sort((a, b) => clipTrackIndices[a] - clipTrackIndices[b])

    const args: string[] = []
    const filterParts: string[] = []

    clipPaths.forEach((path) => args.push('-i', path))
    audioTracks.forEach((track) => args.push('-ss', (track.startMs / 1000).toString(), '-i', track.path))

    const isIdentity = (t: ClipTransformExport | null): boolean =>
      !t || (t.x === 0 && t.y === 0 && t.scaleX === 1 && t.scaleY === 1
        && t.rotation === 0 && t.opacity === 1
        && t.cropTop === 0 && t.cropBottom === 0 && t.cropLeft === 0 && t.cropRight === 0)

    // Build per-clip filters (crop, scale, rotate, opacity)
    clipOrder.forEach((origIdx) => {
      const t = clipTransforms[origIdx]
      const parts: string[] = []
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
      if (parts.length > 0) {
        filterParts.push(`[${origIdx}:v]${parts.join(',')}[vt${origIdx}]`)
      } else {
        filterParts.push(`[${origIdx}:v]null[vt${origIdx}]`)
      }
    })

    // Scale/pad each clip to output resolution
    clipOrder.forEach((origIdx) => {
      filterParts.push(
        `[vt${origIdx}]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=black[vs${origIdx}]`
      )
    })

    // Overlay composition (bottom track first)
    let videoFilter = `[vs${clipOrder[0]}]`
    if (clipOrder.length === 1) {
      // Single clip — just rename label
      filterParts.push(`${videoFilter}null[composited]`)
      videoFilter = '[composited]'
    } else {
      // Concat clips in track order, then overlay
      const concatInputs = clipOrder.map((i) => `[vs${i}]`).join('')
      filterParts.push(`${concatInputs}concat=n=${clipOrder.length}:v=1:a=0[composited]`)
      videoFilter = '[composited]'
    }

    if (srtPath && captionStyle) {
      const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
      // Scale font size proportionally: preview uses width/1080, export uses outputWidth/projectWidth
      const refWidth = projectWidth ?? outputWidth
      const fontSize = Math.round(captionStyle.fontSize * outputWidth / refWidth)
      // ASS color format: &HAABBGGRR (alpha + BGR reversed from #RRGGBB)
      const toAssColor = (hex: string, opacity?: number): string => {
        const alpha = opacity !== undefined ? Math.round(opacity * 255).toString(16).padStart(2, '0').toUpperCase() : '00'
        const r = hex.slice(1, 3)
        const g = hex.slice(3, 5)
        const b = hex.slice(5, 7)
        return `&H${alpha}${b}${g}${r}`
      }
      const fontColor = toAssColor(captionStyle.fontColor)
      const bgColor = toAssColor(captionStyle.bgColor, captionStyle.bgOpacity ?? 0.5)
      const strokeColor = toAssColor(captionStyle.strokeColor ?? '#000000')
      // Map editor alignment + position to ASS Alignment codes (1-9)
      const assAlignment: Record<string, number> = {
        'bottom-left': 1, 'bottom-center': 2, 'bottom-right': 3,
        'center-left': 4, 'center-center': 5, 'center-right': 6,
        'top-left': 7, 'top-center': 8, 'top-right': 9
      }
      const alignKey = `${captionStyle.position ?? 'bottom'}-${captionStyle.alignment ?? 'center'}`
      const alignment = assAlignment[alignKey] ?? 2
      // Compute MarginV from y% based on caption position
      const y = captionStyle.y ?? 90
      const position = captionStyle.position ?? 'bottom'
      let marginV: number
      if (position === 'top') {
        marginV = Math.round(y / 100 * outputHeight)
      } else if (position === 'center') {
        marginV = Math.round(((y - 50) / 100) * outputHeight)
      } else {
        marginV = Math.round((100 - y) / 100 * outputHeight)
      }
      const fontWeight = (captionStyle.fontWeight ?? 500) >= 700 ? '1' : '0'
      const outlineWidth = Math.max(1, Math.round((captionStyle.strokeWidth ?? 0) * outputWidth / refWidth))
      const subtitlesFilter = `${videoFilter}subtitles='${escapedSrtPath}':force_style='FontName=${captionStyle.fontFamily},FontSize=${fontSize},Bold=${fontWeight},PrimaryColour=${fontColor},BackColour=${bgColor},OutlineColour=${strokeColor},Outline=${outlineWidth},Shadow=0,Alignment=${alignment},MarginV=${marginV},MarginL=10,MarginR=10'[captioned]`
      filterParts.push(subtitlesFilter)
      videoFilter = '[captioned]'
    }

    // Audio mixing
    if (clipPaths.length === 1 && audioTracks.length === 0) {
      args.push('-map', '0:a?')
    } else {
      const audioInputs: string[] = []
      clipPaths.forEach((_, i) => audioInputs.push(`[${i}:a:0]`))
      audioTracks.forEach((track, i) => {
        const inputIdx = clipPaths.length + i
        filterParts.push(`[${inputIdx}:a:0]volume=${(track.volume ?? 1).toFixed(2)}[av${i}]`)
        audioInputs.push(`[av${i}]`)
      })
      if (audioInputs.length > 1) {
        filterParts.push(`${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=first:dropout_transition=2[aout]`)
        args.push('-map', '[aout]')
      } else if (audioInputs.length === 1) {
        args.push('-map', '0:a?')
      }
    }

    if (filterParts.length > 0) args.push('-filter_complex', filterParts.join(';'))
    args.push('-map', videoFilter)

    switch (codec) {
      case 'h264':
        args.push('-c:v', 'libx264', '-preset', qualityPreset, '-crf', qualityPreset === 'fast' ? '23' : '18')
        args.push('-c:a', 'aac', '-b:a', qualityPreset === 'fast' ? '128k' : '192k')
        break
      case 'h265':
        args.push('-c:v', 'libx265', '-preset', qualityPreset, '-crf', '18')
        args.push('-c:a', 'aac', '-b:a', '192k')
        break
      case 'prores':
        args.push('-c:v', 'prores_ks', '-profile:v', '3', '-c:a', 'pcm_s16le')
        break
      case 'vp9':
        args.push('-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k')
        break
    }

    args.push('-movflags', '+faststart', '-y', outputPath)
    return args
  }

  /** Upscale video using lanczos/bicubic filter */
  upscaleVideo(
    inputPath: string, outputPath: string,
    targetWidth: number, targetHeight: number,
    algorithm: 'lanczos' | 'bicubic' = 'lanczos',
    totalDurationMs = 0, onProgress?: ProgressCallback
  ): { process: ChildProcess; promise: Promise<void> } {
    const args = [
      '-i', inputPath,
      '-vf', `scale=${targetWidth}:${targetHeight}:flags=${algorithm}`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      '-c:a', 'copy', '-y', outputPath
    ]
    return this.spawn(args, totalDurationMs, onProgress)
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
