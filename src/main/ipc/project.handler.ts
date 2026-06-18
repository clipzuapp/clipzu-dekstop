import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { generateSRT, generateExportSRT, type ExportSRTOptions } from '../../shared/utils/srt'

/**
 * Project IPC handlers - Save/Load .ecp project files
 */

/**
 * Caption style fields persisted in .ecp project files.
 * Must stay in sync with renderer CaptionStyle (useCaption.ts).
 */
interface ProjectCaptionStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  strokeColor: string
  strokeWidth: number
  bgColor: string
  bgOpacity: number
  alignment: 'left' | 'center' | 'right'
  position: 'top' | 'center' | 'bottom'
  x: number
  y: number
  rotation: number
  scale: number
  animation: string
  captionMode: string
  revealFadeMs?: number
}

interface ProjectFile {
  version: string
  name: string
  fps: number
  resolution: { width: number; height: number }
  aspectRatio?: string
  clips: Array<{
    id: string
    path: string
    startMs: number
    durationMs: number
    sourceDurationMs?: number
    trackIndex: number
    trimStart: number
    trimEnd: number
    name?: string
  }>
  audioTracks: Array<{
    id: string
    path: string
    startMs: number
    durationMs?: number
    volume: number
    muted: boolean
    name?: string
    role?: 'voice' | 'music' | 'sfx' | 'ambient'
  }>
  textClips?: Array<{
    id: string
    startMs: number
    durationMs: number
    endMs: number
    trackIndex: number
    text: string
    style?: ProjectCaptionStyle
    words?: Array<{ word: string; startMs: number; endMs: number }>
    sourceId?: string
    sourceType?: 'clip' | 'audioTrack' | 'timeline' | 'import'
    transcriptionJobId?: string
  }>
  captions: {
    entries: Array<{
      id: string
      text: string
      startMs: number
      endMs: number
      durationMs: number
      trackIndex: number
      style?: ProjectCaptionStyle
      words?: Array<{ word: string; startMs: number; endMs: number }>
      sourceId?: string
      sourceType?: 'clip' | 'audioTrack' | 'timeline' | 'import'
      transcriptionJobId?: string
    }>
    style: ProjectCaptionStyle
    language: string
  }
  exportPreset: string
}

export function registerProjectHandler(getWindow: () => BrowserWindow | null): void {
  // Save project to file
  ipcMain.handle('project:save', async (_event, projectData: ProjectFile, filePath?: string) => {
    const win = getWindow()

    let savePath = filePath
    if (!savePath) {
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        defaultPath: `${projectData.name || 'project'}.ecp`,
        filters: [
          { name: 'Capcraft Project', extensions: ['ecp'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePath) return null
      savePath = result.filePath
    }

    try {
      const dir = dirname(savePath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      await writeFile(savePath, JSON.stringify(projectData, null, 2), 'utf-8')
      return savePath
    } catch (err) {
      throw new Error(`Failed to save project: ${(err as Error).message}`)
    }
  })

  // Load project from file
  ipcMain.handle('project:load', async () => {
    const win = getWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Capcraft Project', extensions: ['ecp'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null

    try {
      const content = await readFile(result.filePaths[0], 'utf-8')
      const projectData = JSON.parse(content) as ProjectFile
      return { data: projectData, filePath: result.filePaths[0] }
    } catch (err) {
      throw new Error(`Failed to load project: ${(err as Error).message}`)
    }
  })

  // Export SRT sidecar file
  ipcMain.handle(
    'project:exportSRT',
    async (
      _event,
      entries: Array<{ startMs: number; endMs: number; text: string }>,
      outputPath: string
    ) => {
      try {
        const srtContent = generateSRT(entries)

        // Auto-generate SRT path from output path
        const srtPath = outputPath.replace(/\.[^.]+$/, '.srt')
        await writeFile(srtPath, srtContent, 'utf-8')
        return srtPath
      } catch (err) {
        throw new Error(`Failed to export SRT: ${(err as Error).message}`)
      }
    }
  )

  // Create temp SRT for export (burn-in captions) — supports caption modes and animations
  ipcMain.handle(
    'project:createTempSRT',
    async (
      _event,
      entries: Array<{
        startMs: number
        endMs: number
        text: string
        words?: Array<{ word: string; startMs: number; endMs: number }>
      }>,
      options?: ExportSRTOptions
    ) => {
      try {
        const os = require('os')
        const path = require('path')
        const tmpDir = path.join(os.tmpdir(), 'capcraft')

        if (!existsSync(tmpDir)) {
          await mkdir(tmpDir, { recursive: true })
        }

        const srtPath = join(tmpDir, `temp_captions_${Date.now()}.srt`)
        const srtContent = generateExportSRT(entries, options ?? {})

        await writeFile(srtPath, srtContent, 'utf-8')
        return srtPath
      } catch (err) {
        throw new Error(`Failed to create temp SRT: ${(err as Error).message}`)
      }
    }
  )
}
