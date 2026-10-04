import { ipcMain, BrowserWindow } from 'electron'
import { WhisperService } from '../services/WhisperService'
import type { FFmpegService } from '../services/FFmpegService'
import { unlinkSync, existsSync } from 'fs'
import { writeDiagnostic } from '../services/DiagnosticLog'

/**
 * Whisper IPC handlers - Audio transcription via worker_threads.
 * Accepts WhisperService and FFmpegService instances via DI.
 */
export function registerWhisperHandler(
  getWindow: () => BrowserWindow | null,
  whisper: WhisperService,
  ffmpeg?: FFmpegService
): void {
  // Check if Whisper model is available
  ipcMain.handle('whisper:isModelAvailable', async () => {
    return whisper.isModelAvailable()
  })

  // Validate model compatibility (async, non-blocking)
  ipcMain.handle('whisper:validateModel', async () => {
    await whisper.resolveModelPathAsync()
    const validation = whisper.getLastValidation()
    return validation
  })

  // Full diagnostics for the UI Diagnostics button
  ipcMain.handle('whisper:getDiagnostics', async () => {
    return whisper.getDiagnostics()
  })

  // Live diagnostic tests (binary help, model load, audio process)
  ipcMain.handle('whisper:runDiagnosticTests', async () => {
    return whisper.runDiagnosticTests()
  })

  // Start transcription
  ipcMain.handle(
    'whisper:transcribe',
    async (_event, audioPath: string, language?: string, wordTimestamps?: boolean) => {
      const win = getWindow()

      try {
        if (!whisper.isModelAvailable()) {
          throw new Error('The transcription model is missing. Use “Download transcription model” in the startup banner, then retry.')
        }
        const result = await whisper.transcribe({
          audioPath,
          language: language || 'auto',
          wordTimestamps: wordTimestamps ?? true,
          onProgress: (percent) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send('whisper:progress', percent)
            }
          }
        })

        return result
      } catch (err) {
        writeDiagnostic('ERROR', 'transcription.failed', err instanceof Error ? err.stack ?? err.message : String(err))
        throw new Error(`Transcription failed: ${(err as Error).message}`)
      }
    }
  )

  // Cancel active transcription
  ipcMain.handle('whisper:cancel', async () => {
    whisper.cancel()
    return { success: true }
  })

  // Transcribe from timeline (clip or mixed audio)
  ipcMain.handle(
    'whisper:transcribeFromTimeline',
    async (_event, params: {
      type: 'clip' | 'timeline'
      clipPath?: string
      mixPaths?: string[]
      /** Time-offset sources for accurate timeline audio mixing */
      mixSources?: Array<{ path: string; startMs: number; durationMs: number }>
      /** Trim offsets for clip-level transcription */
      trimStartMs?: number
      trimEndMs?: number
      sourceDurationMs?: number
      language: string
    }) => {
      const win = getWindow()

      // Use the DI-injected FFmpegService if available, fallback to inline instantiation
      const audioFFmpeg = ffmpeg ?? (() => {
        const { FFmpegService: FFSvc } = require('../services/FFmpegService')
        return new FFSvc(
          require('electron').app.isPackaged
            ? require('path').join(require('process').resourcesPath, 'bin', 'ffmpeg.exe')
            : require('ffmpeg-static'),
          ''
        )
      })()

      let audioPath = params.clipPath

      try {
        if (!whisper.isModelAvailable()) {
          throw new Error('The transcription model is missing. Use “Download transcription model” in the startup banner, then retry.')
        }
        const progress = (percent: number) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('whisper:progress', percent * 0.1) // 0-10%
          }
        }

        if (params.type === 'clip' && params.clipPath) {
          audioPath = await audioFFmpeg.extractAudio(params.clipPath, undefined, progress)
        } else if (params.type === 'timeline') {
          if (params.mixSources && params.mixSources.length > 0) {
            // Time-offset-aware mixing: uses adelay+amix for correct timeline positioning
            audioPath = await audioFFmpeg.mixTimelineAudioWithOffsets(params.mixSources, undefined, progress)
          } else if (params.mixPaths && params.mixPaths.length > 0) {
            // Legacy path: flat mixing without time offsets (backward compat)
            audioPath = await audioFFmpeg.mixAudioFiles(params.mixPaths, undefined, progress)
          }
        }

        // Bridge extraction process to WhisperService so cancel() can kill it during extraction
        whisper.activeExtractionProcess = audioFFmpeg.lastExtractionProcess

        if (!audioPath) {
          throw new Error('Failed to extract/mix audio')
        }

        // Send progress: 10-100% (whisper service emits 10-100 directly)
        if (win && !win.isDestroyed()) {
          win.webContents.send('whisper:progress', 10)
        }

        // Transcribe — WhisperService is the sole progress authority (no remapping)
        const result = await whisper.transcribe({
          audioPath,
          language: params.language || 'auto',
          wordTimestamps: true,
          trimStartMs: params.trimStartMs,
          trimEndMs: params.trimEndMs,
          sourceDurationMs: params.sourceDurationMs,
          onProgress: (percent) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send('whisper:progress', percent)
            }
          }
        })

        return result
      } catch (err) {
        writeDiagnostic('ERROR', 'timeline-transcription.failed', err instanceof Error ? err.stack ?? err.message : String(err))
        throw new Error(`Transcription failed: ${(err as Error).message}`)
      } finally {
        whisper.activeExtractionProcess = null
        // Clean up temp WAV if extraction created one (original clipPath is never deleted)
        if (audioPath && audioPath !== params.clipPath && existsSync(audioPath)) {
          try { unlinkSync(audioPath) } catch { /* best effort */ }
        }
      }
    }
  )
}
