import { ChildProcess } from 'child_process'
import { BrowserWindow } from 'electron'
import { FFmpegService, FFmpegProgress, ClipTransformExport } from './FFmpegService'

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
  clipTransforms: Array<ClipTransformExport | null>
  audioTracks: Array<{ path: string; startMs: number; volume: number }>
  srtPath: string | null
  captionStyle: {
    fontFamily: string
    fontSize: number
    fontColor: string
    bgColor: string
    bgOpacity: number
  } | null
  outputWidth: number
  outputHeight: number
  codec: 'h264' | 'h265' | 'prores' | 'vp9'
  qualityPreset: 'fast' | 'slow'
  outputPath: string
  upscaleEnabled?: boolean
  upscaleAlgorithm?: 'lanczos' | 'bicubic'
  totalDurationMs: number
}

const MAX_CONCURRENT = 1

class ExportQueueManager {
  private queue: Array<{ job: ExportJob; params: ExportParams }> = []
  private activeJobs: Map<string, { job: ExportJob; process: ChildProcess; controller: AbortController }> = new Map()
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

    const args = this.ffmpeg.buildExportCommand({
      clipPaths: params.clipPaths,
      clipTrackIndices: params.clipTrackIndices,
      clipTransforms: params.clipTransforms,
      audioTracks: params.audioTracks,
      srtPath: params.srtPath,
      captionStyle: params.captionStyle,
      outputWidth: params.upscaleEnabled ? Math.round(params.outputWidth / 2) : params.outputWidth,
      outputHeight: params.upscaleEnabled ? Math.round(params.outputHeight / 2) : params.outputHeight,
      codec: params.codec,
      qualityPreset: params.qualityPreset,
      outputPath: params.upscaleEnabled ? `${params.outputPath}.tmp.mp4` : params.outputPath
    })

    const onProgress = (progress: FFmpegProgress): void => {
      if (controller.signal.aborted) return

      const jobEntry = this.activeJobs.get(job.id)
      if (!jobEntry) return

      jobEntry.job.progress = progress.percent
      this.sendProgress(job.id, progress.percent, progress.fps, progress.speed)
    }

    const { process: ffmpegProcess, promise } = this.ffmpeg.spawn(args, params.totalDurationMs, onProgress)

    this.activeJobs.set(job.id, { job, process: ffmpegProcess, controller })

    promise
      .then(async () => {
        if (controller.signal.aborted) return

        // Handle upscale if enabled
        if (params.upscaleEnabled) {
          const tmpPath = `${params.outputPath}.tmp.mp4`
          this.sendProgress(job.id, 50, 0, 'upscaling')

          const upscalePromise = this.ffmpeg.upscaleVideo(
            tmpPath,
            params.outputPath,
            params.outputWidth,
            params.outputHeight,
            params.upscaleAlgorithm || 'lanczos',
            params.totalDurationMs,
            (progress) => {
              // Scale upscale progress from 50-100%
              const scaledPercent = 50 + progress.percent * 0.5
              this.sendProgress(job.id, scaledPercent, progress.fps, progress.speed)
            }
          )

          try {
            await upscalePromise.promise
            // Cleanup temp file
            const fs = require('fs')
            try { fs.unlinkSync(tmpPath) } catch (_e) { /* ignore */ }
          } catch (err) {
            throw err
          }
        }

        job.status = 'completed'
        job.progress = 100
        job.completedAt = Date.now()
        this.activeJobs.delete(job.id)
        this.completedJobs.set(job.id, { ...job })
        this.sendProgress(job.id, 100, 0, job.status)
        this.processQueue()
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) {
          job.status = 'cancelled'
        } else {
          job.status = 'error'
          job.error = err.message
        }
        job.completedAt = Date.now()
        this.activeJobs.delete(job.id)
        this.completedJobs.set(job.id, { ...job })
        this.sendProgress(job.id, job.progress, 0, job.status)
        this.processQueue()
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
