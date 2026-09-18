import { ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { unlink } from 'fs/promises'
import { FFmpegService, FFmpegProgress, ClipTransformExport } from './FFmpegService'
import type { ExportCaptionStyle } from '../../shared/utils/srt'
import type {
  ExportAnimatedFilter,
  ExportTimeSegment,
  SlideGeometry,
  ZoomGeometry,
} from '../../shared/export/exportGraph'

// Re-export so callers that previously imported from here keep working
export type { ExportCaptionStyle }

/**
 * ExportQueue - Priority queue for export jobs
 * MAX 1 concurrent job (RAM constraint: 16GB)
 * Jobs are cancellable via AbortController + killing FFmpeg child process
 */

interface ExportJob {
  id: string
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'error'
  progress: number
  outputPath: string
  error?: string
  createdAt: number
  completedAt?: number
}

interface ExportParams {
  clipPaths: string[]
  clipTrackIndices: number[]
  clipHasAudio?: boolean[]
  clipHidden?: boolean[]
  clipVideoMuted?: boolean[]
  clipFadeInMs?: number[]
  clipFadeOutMs?: number[]
  clipTransforms: Array<ClipTransformExport | null>
  clipVolumes?: Array<{ volume: number; muted: boolean }>
  clipStartMs?: number[]
  clipDurationMs?: number[]
  clipTrimStarts?: number[]
  clipSpeeds?: number[]
  // Phase 7 (shared export graph output — see buildExportGraph).
  clipVideoFilters?: string[][]
  clipVideoAnimated?: ExportAnimatedFilter[][]
  clipAnimatedOpacity?: ExportTimeSegment[][]
  clipAnimatedVolume?: ExportTimeSegment[][]
  clipBlends?: (string | null)[]
  clipTransitionFadeInMs?: number[]
  clipTransitionFadeOutMs?: number[]
  clipSlideOut?: (SlideGeometry | null)[]
  clipSlideIn?: (SlideGeometry | null)[]
  clipZoomOut?: (ZoomGeometry | null)[]
  clipZoomIn?: (ZoomGeometry | null)[]
  audioAnimatedVolume?: ExportTimeSegment[][]
  exportFrameRange?: { startMs: number; endMs: number } | null
  audioOnly?: boolean
  bitrateKbps?: number | null
  bitrateMode?: 'auto' | 'cbr' | 'vbr'
  useNvenc?: boolean
  audioTracks: Array<{ path: string; startMs: number; volume: number; trimStart?: number; durationMs?: number; fadeInMs?: number; fadeOutMs?: number }>
  srtPath: string | null
  captionStyle: ExportCaptionStyle | null
  outputWidth: number
  outputHeight: number
  projectWidth: number
  projectHeight: number
  codec: 'h264' | 'h265' | 'prores' | 'vp9'
  qualityPreset: 'fast' | 'slow'
  outputPath: string
  upscaleEnabled?: boolean
  upscaleAlgorithm?: 'lanczos' | 'bicubic'
  totalDurationMs: number
  fps?: 24 | 30 | 60
}

const MAX_CONCURRENT = 1

/** req 2.22 — Delete temp files registered for a job; ignore ENOENT */
async function cleanupTempFiles(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (filePath) => {
      try {
        await unlink(filePath)
      } catch {
        // Non-fatal — file may already be gone
      }
    })
  )
}

class ExportQueueManager {
  private queue: Array<{ job: ExportJob; params: ExportParams }> = []
  private activeJobs: Map<string, { job: ExportJob; process: ChildProcess; controller: AbortController; tempFiles: string[] }> = new Map()
  private completedJobs: Map<string, ExportJob> = new Map()
  private getWindow: () => BrowserWindow | null
  private ffmpeg: FFmpegService

  constructor(getWindow: () => BrowserWindow | null, ffmpeg: FFmpegService) {
    this.getWindow = getWindow
    this.ffmpeg = ffmpeg
  }

  /**
   * Add a new export job to the queue
   */
  addJob(params: ExportParams): ExportJob {
    const job: ExportJob = {
      id: `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      progress: 0,
      outputPath: params.outputPath,
      createdAt: Date.now()
    }

    this.queue.push({ job, params })
    this.processQueue()

    return job
  }

  /**
   * Process the queue - start next job if under MAX_CONCURRENT limit
   */
  private processQueue(): void {
    while (this.activeJobs.size < MAX_CONCURRENT && this.queue.length > 0) {
      const next = this.queue.shift()
      if (next) {
        this.startJob(next.job, next.params)
      }
    }
  }

  /**
   * Start an export job
   */
  private startJob(job: ExportJob, params: ExportParams): void {
    const controller = new AbortController()
    job.status = 'running'

    const tempFiles: string[] = []
    if (params.srtPath && /temp_captions_/i.test(params.srtPath)) {
      tempFiles.push(params.srtPath)
    }

    // req 2.2 — Single-pass encode at full target resolution (no half-res intermediate)
    // Phase 7: frame-range exports validate/parse progress against the RANGE
    // length, not the full timeline.
    const range = params.exportFrameRange
    const rangeValid = !!range && range.endMs > range.startMs
    const effectiveDurationMs = rangeValid
      ? range!.endMs - range!.startMs
      : params.totalDurationMs
    const args = this.ffmpeg.buildExportCommand({
      clipPaths: params.clipPaths,
      clipTrackIndices: params.clipTrackIndices,
      clipHasAudio: params.clipHasAudio,
      clipHidden: params.clipHidden,
      clipVideoMuted: params.clipVideoMuted,
      clipFadeInMs: params.clipFadeInMs,
      clipFadeOutMs: params.clipFadeOutMs,
      clipTransforms: params.clipTransforms,
      clipVolumes: params.clipVolumes,
      clipStartMs: params.clipStartMs,
      clipDurationMs: params.clipDurationMs,
      clipTrimStarts: params.clipTrimStarts,
      clipSpeeds: params.clipSpeeds,
      clipVideoFilters: params.clipVideoFilters,
      clipVideoAnimated: params.clipVideoAnimated,
      clipAnimatedOpacity: params.clipAnimatedOpacity,
      clipAnimatedVolume: params.clipAnimatedVolume,
      clipBlends: params.clipBlends,
      clipTransitionFadeInMs: params.clipTransitionFadeInMs,
      clipTransitionFadeOutMs: params.clipTransitionFadeOutMs,
      clipSlideOut: params.clipSlideOut,
      clipSlideIn: params.clipSlideIn,
      clipZoomOut: params.clipZoomOut,
      clipZoomIn: params.clipZoomIn,
      exportFrameRange: rangeValid ? range : null,
      audioOnly: params.audioOnly,
      bitrateKbps: params.bitrateKbps,
      bitrateMode: params.bitrateMode,
      useNvenc: params.useNvenc,
      audioTracks: params.audioTracks,
      audioAnimatedVolume: params.audioAnimatedVolume,
      srtPath: params.srtPath,
      captionStyle: params.captionStyle,
      outputWidth: params.outputWidth,
      outputHeight: params.outputHeight,
      projectWidth: params.projectWidth,
      projectHeight: params.projectHeight,
      fps: params.fps,
      codec: params.codec,
      qualityPreset: params.qualityPreset,
      totalDurationMs: effectiveDurationMs,
      outputPath: params.outputPath
    })

    const onProgress = (progress: FFmpegProgress): void => {
      if (controller.signal.aborted) return

      const jobEntry = this.activeJobs.get(job.id)
      if (!jobEntry) return

      jobEntry.job.progress = progress.percent
      this.sendProgress(job.id, progress.percent, progress.fps, progress.speed)
    }

    const { process: ffmpegProcess, promise } = this.ffmpeg.spawn(args, effectiveDurationMs, onProgress)

    this.activeJobs.set(job.id, { job, process: ffmpegProcess, controller, tempFiles })

    const finishJob = async (status: ExportJob['status'], error?: string): Promise<void> => {
      await cleanupTempFiles(tempFiles)
      job.status = status
      job.error = error
      job.completedAt = Date.now()
      this.activeJobs.delete(job.id)
      this.completedJobs.set(job.id, { ...job })
      this.sendProgress(job.id, job.progress, 0, status)
      this.processQueue()
    }

    promise
      .then(async () => {
        if (controller.signal.aborted) {
          await finishJob('cancelled')
          return
        }

        // req 2.19 — Post-export ffprobe validation
        const hasClipAudio = (params.clipHasAudio ?? params.clipPaths.map(() => true)).some(
          (has, i) =>
            has !== false &&
            !params.clipHidden?.[i] &&
            !params.clipVideoMuted?.[i] &&
            (params.clipVolumes?.[i]?.volume ?? 1) > 0
        )
        const expectAudio = hasClipAudio || params.audioTracks.length > 0

        try {
          await this.ffmpeg.validateExportOutput(params.outputPath, {
            width: params.outputWidth,
            height: params.outputHeight,
            totalDurationMs: effectiveDurationMs,
            expectAudio,
            expectVideo: !params.audioOnly
          })
        } catch (validationErr) {
          await finishJob('error', (validationErr as Error).message)
          return
        }

        job.progress = 100
        await finishJob('completed')
      })
      .catch(async (err: Error) => {
        if (controller.signal.aborted) {
          await finishJob('cancelled')
        } else {
          await finishJob('error', err.message)
        }
      })
  }

  /**
   * Cancel a running or queued job
   */
  cancelJob(jobId: string): boolean {
    // Check active jobs
    const activeEntry = this.activeJobs.get(jobId)
    if (activeEntry) {
      activeEntry.controller.abort()
      try {
        activeEntry.process.kill('SIGTERM')
      } catch (_e) {
        // Process may have already exited
      }
      return true
    }

    // Check pending queue
    const queueIndex = this.queue.findIndex((q) => q.job.id === jobId)
    if (queueIndex >= 0) {
      const removed = this.queue.splice(queueIndex, 1)
      if (removed[0]) {
        removed[0].job.status = 'cancelled'
        removed[0].job.completedAt = Date.now()
        this.completedJobs.set(removed[0].job.id, removed[0].job)
      }
      return true
    }

    return false
  }

  /**
   * Get all jobs (active + queued + completed)
   */
  getAllJobs(): ExportJob[] {
    const active = Array.from(this.activeJobs.values()).map((e) => ({ ...e.job }))
    const pending = this.queue.map((q) => ({ ...q.job }))
    const completed = Array.from(this.completedJobs.values())
    return [...active, ...pending, ...completed].sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Clear completed/cancelled/errored jobs from history
   */
  clearCompleted(): void {
    this.completedJobs.clear()
  }

  /**
   * Kill all active and pending jobs — called during app shutdown to prevent
   * zombie child processes from blocking exit.
   */
  destroy(): void {
    for (const [id, entry] of this.activeJobs) {
      entry.controller.abort()
      try { entry.process.kill('SIGKILL') } catch { /* already exited */ }
      entry.job.status = 'cancelled'
      this.completedJobs.set(id, { ...entry.job })
    }
    this.activeJobs.clear()
    // Mark all pending jobs as cancelled
    for (const { job } of this.queue) {
      job.status = 'cancelled'
      job.completedAt = Date.now()
      this.completedJobs.set(job.id, job)
    }
    this.queue = []
  }

  /**
   * Send progress update to renderer via IPC.
   * @param eventLabel — speed string like "1.5x", upscale status "upscaling", or job status "completed"/"error"/"cancelled".
   *                     page.tsx matches on 'completed'/'cancelled'/'error' to set terminal state.
   */
  private sendProgress(jobId: string, progress: number, fps: number, eventLabel: string): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('export:progress', {
        jobId, progress: Math.round(progress * 10) / 10, fps, status: eventLabel
      })
    }
  }
}

let queueInstance: ExportQueueManager | null = null

export function getExportQueue(getWindow: () => BrowserWindow | null, ffmpeg: FFmpegService): ExportQueueManager {
  if (!queueInstance) {
    queueInstance = new ExportQueueManager(getWindow, ffmpeg)
  }
  return queueInstance
}

export type { ExportJob, ExportParams }
export { ExportQueueManager }
