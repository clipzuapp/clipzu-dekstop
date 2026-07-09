import { ipcMain } from 'electron'
import { ExportQueueManager } from '../services/ExportQueue'
import type { ExportParams } from '../services/ExportQueue'
import type { FFmpegService } from '../services/FFmpegService'

/**
 * Export IPC handlers - Job management, progress streaming.
 * Accepts ExportQueueManager instance via DI — no singleton getExportQueue.
 */
export function registerExportHandler(queue: ExportQueueManager, ffmpeg?: FFmpegService): void {
  // Start a new export job
  ipcMain.handle('export:start', async (_event, params: ExportParams) => {
    const job = queue.addJob(params)
    return job
  })

  // Cancel an export job
  ipcMain.handle('export:cancel', async (_event, jobId: string) => {
    const cancelled = queue.cancelJob(jobId)
    return { success: cancelled }
  })

  // Get all export jobs
  ipcMain.handle('export:getJobs', async () => {
    return queue.getAllJobs()
  })

  // Clear completed jobs from history
  ipcMain.handle('export:clearCompleted', async () => {
    queue.clearCompleted()
    return { success: true }
  })

  // Detect hardware acceleration availability
  ipcMain.handle('export:detectAccel', async () => {
    if (!ffmpeg) return { nvenc: false, qsv: false, amf: false }
    return ffmpeg.detectHardwareAccel()
  })
}
