import { ipcMain, dialog, app } from 'electron'
import { join } from 'path'
import { readdirSync, statSync, existsSync } from 'fs'
import type { BrowserWindow } from 'electron'
import { FFmpegService } from '../services/FFmpegService'

/**
 * SFX IPC Handler - Reads sound effects from assets/sfx folder
 * Provides file list and metadata to renderer process
 */

interface SFXFile {
  id: string
  name: string
  path: string
  size: number
  category: string
  durationMs: number
}

let ffmpegService: FFmpegService | null = null

function getFFmpegService(): FFmpegService {
  if (!ffmpegService) {
    const binDir = app.isPackaged
      ? join(process.resourcesPath, 'bin')
      : join(app.getAppPath(), 'resources', 'bin')
    
    const ffmpegPath = process.platform === 'win32'
      ? join(binDir, 'ffmpeg.exe')
      : join(binDir, 'ffmpeg')
    
    const ffprobePath = ffmpegPath.replace('ffmpeg', 'ffprobe')
    
    ffmpegService = new FFmpegService(ffmpegPath, ffprobePath)
  }
  return ffmpegService
}

export function registerSFXHandler(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('sfx:getLibrary', async (): Promise<SFXFile[]> => {
    try {
      const sfxDir = app.isPackaged
        ? join(process.resourcesPath, 'assets', 'sfx')
        : join(app.getAppPath(), 'assets', 'sfx')

      if (!existsSync(sfxDir)) {
        console.warn('[SFX] Directory not found:', sfxDir)
        return []
      }

      const filenames = readdirSync(sfxDir).filter(f => f.toLowerCase().endsWith('.mp3'))
      
      // Get file metadata and duration
      const files: SFXFile[] = []
      for (const filename of filenames) {
        const filePath = join(sfxDir, filename)
        const stats = statSync(filePath)
        
        // Extract category from filename (e.g., "click-1.mp3" -> "click")
        const category = filename
          .replace(/\.mp3$/i, '')
          .replace(/-\d+$/, '')
          .replace(/-/g, ' ')

        // Get audio duration using ffprobe
        let durationMs = 0
        try {
          const service = getFFmpegService()
          const info = await service.getMediaInfo(filePath)
          durationMs = info.durationMs
        } catch (err) {
          console.warn(`[SFX] Failed to get duration for ${filename}:`, err)
        }

        files.push({
          id: `sfx_${filename.replace(/[^a-zA-Z0-9]/g, '_')}`,
          name: filename.replace(/\.mp3$/i, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          path: filePath,
          size: stats.size,
          category,
          durationMs
        })
      }

      files.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
      return files
    } catch (error) {
      console.error('[SFX] Failed to read library:', error)
      return []
    }
  })

  ipcMain.handle('sfx:openFileLocation', async (_event, filePath: string): Promise<void> => {
    try {
      const { shell } = await import('electron')
      shell.showItemInFolder(filePath)
    } catch (error) {
      console.error('[SFX] Failed to open file location:', error)
    }
  })
}
