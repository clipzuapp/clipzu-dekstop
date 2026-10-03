import { ipcMain, dialog, BrowserWindow } from 'electron'
import { FFmpegService } from '../services/FFmpegService'
import { ThumbnailService } from '../services/ThumbnailService'
import { mediaDialogFilters } from '../../shared/media/extensions'

/**
 * FFmpeg IPC handlers - Media info, frame extraction, thumbnails.
 * Accepts service instances via DI — no module-level imports of service functions.
 */
export function registerFFmpegHandler(
  getWindow: () => BrowserWindow | null,
  ffmpeg: FFmpegService,
  thumbnails: ThumbnailService
): void {
  // Get media file info (duration, resolution, fps, codec)
  ipcMain.handle('ffmpeg:getMediaInfo', async (_event, filePath: string) => {
    try {
      return await ffmpeg.getMediaInfo(filePath)
    } catch (err) {
      throw new Error(`Failed to get media info: ${(err as Error).message}`)
    }
  })

  // Extract a single frame as base64
  ipcMain.handle(
    'ffmpeg:extractFrame',
    async (_event, filePath: string, frameMs: number, width?: number) => {
      try {
        return await ffmpeg.extractFrame(filePath, frameMs, width || 160)
      } catch (err) {
        throw new Error(`Failed to extract frame: ${(err as Error).message}`)
      }
    }
  )

  // Get or create cached thumbnail
  ipcMain.handle(
    'ffmpeg:getThumbnail',
    async (_event, clipPath: string, frameMs: number, width?: number) => {
      try {
        return await thumbnails.getOrCreateThumbnail(clipPath, frameMs, width || 160)
      } catch (err) {
        throw new Error(`Failed to get thumbnail: ${(err as Error).message}`)
      }
    }
  )

  // Get thumbnail strip for timeline rendering
  ipcMain.handle(
    'ffmpeg:getThumbnailStrip',
    async (_event, clipPath: string, durationMs: number, frameCount?: number, width?: number) => {
      try {
        return await thumbnails.getThumbnailStrip(clipPath, durationMs, frameCount || 10, width || 80)
      } catch (err) {
        throw new Error(`Failed to get thumbnail strip: ${(err as Error).message}`)
      }
    }
  )

  // Clear thumbnail cache
  ipcMain.handle('ffmpeg:clearThumbnailCache', async () => {
    try {
      thumbnails.clearCache()
      return { success: true }
    } catch (err) {
      throw new Error(`Failed to clear cache: ${(err as Error).message}`)
    }
  })

  // Get thumbnail cache stats
  ipcMain.handle('ffmpeg:getCacheStats', async () => {
    try {
      return thumbnails.getCacheStats()
    } catch (err) {
      throw new Error(`Failed to get cache stats: ${(err as Error).message}`)
    }
  })

  // Open file dialog for video/audio selection
  ipcMain.handle('ffmpeg:openMediaDialog', async () => {
    const win = getWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: mediaDialogFilters()
    })

    if (result.canceled) return null
    return result.filePaths
  })

  // Open save dialog for export
  ipcMain.handle('ffmpeg:openSaveDialog', async (_event, defaultName: string) => {
    const win = getWindow()
    if (!win) return null

    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'WebM Video', extensions: ['webm'] },
        { name: 'MOV Video', extensions: ['mov'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled) return null
    return result.filePath
  })

  // Extract audio from clip for transcription
  ipcMain.handle('ffmpeg:extractAudioFromClip', async (_event, clipPath: string) => {
    try {
      const audioPath = await ffmpeg.extractAudio(clipPath)
      return audioPath
    } catch (err) {
      throw new Error(`Failed to extract audio: ${(err as Error).message}`)
    }
  })

  // Mix multiple audio files for timeline transcription
  ipcMain.handle('ffmpeg:mixTimelineAudio', async (_event, paths: string[]) => {
    try {
      const audioPath = await ffmpeg.mixAudioFiles(paths)
      return audioPath
    } catch (err) {
      throw new Error(`Failed to mix audio: ${(err as Error).message}`)
    }
  })
}
