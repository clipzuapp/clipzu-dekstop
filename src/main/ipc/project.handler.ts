import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { createHash } from 'crypto'
import {
  generateSRT,
  generateExportSRT,
  generateExportASS,
  type ExportSRTOptions,
  type ExportASSOptions,
  type ExportCaptionStyle
} from '../../shared/utils/srt'
import type { CaptionStyle } from '../../shared/types/caption'

/**
 * ProjectCaptionStyle is CaptionStyle. The alias is kept so the ProjectFile
 * interface below reads clearly in context. The compiler enforces consistency.
 */
type ProjectCaptionStyle = CaptionStyle

interface ProjectFile {
  version: string
  name: string
  fps: number
  resolution: { width: number; height: number }
  aspectRatio?: string
  backgroundColor?: string
  clips: Array<{
    id: string
    path: string
    startMs: number
    sourceDurationMs: number
    durationMs: number
    trackIndex: number
    trimStart: number
    trimEnd: number
    name?: string
    hasAudio?: boolean
    speed: number
    volume: number
    muted: boolean
    fadeInMs?: number
    fadeOutMs?: number
    transform?: {
      x: number; y: number; scaleX: number; scaleY: number
      rotation: number; opacity: number
      cropLeft: number; cropRight: number; cropTop: number; cropBottom: number
    }
    keyframes?: Array<{
      id: string; property: string
      points: Array<{ timeMs: number; value: number; easing: string }>
    }>
    modifiers?: Array<{
      id: string; type: string; params: Record<string, unknown>
      enabled: boolean; order: number
    }>
    outTransition?: { type: string; durationMs: number }
    blendMode?: string
  }>
  audioTracks: Array<{
    id: string
    path: string
    startMs: number
    sourceDurationMs: number
    durationMs: number
    volume: number
    muted: boolean
    name?: string
    role: 'voice' | 'music' | 'sfx' | 'ambient'
    trimStart: number
    trimEnd: number
    trackIndex: number
    fadeInMs?: number
    fadeOutMs?: number
    keyframes?: Array<{
      id: string; property: string
      points: Array<{ timeMs: number; value: number; easing: string }>
    }>
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
    wordTimestampsSource?: 'whisper' | 'synthetic'
    sourceId?: string
    sourceType?: 'clip' | 'audioTrack' | 'timeline' | 'import'
    transcriptionJobId?: string
    originalWords?: Array<{ word: string; startMs: number; endMs: number }>
    originalStartMs?: number
    originalEndMs?: number
    fadeInMs?: number
    fadeOutMs?: number
    keyframes?: Array<{
      id: string; property: string
      points: Array<{ timeMs: number; value: number; easing: string }>
    }>
  }>
  tracks?: Array<{
    id: string
    index: number
    name: string
    kind: 'video' | 'audio' | 'caption' | 'overlay'
    muted: boolean
    locked: boolean
    hidden: boolean
    solo: boolean
  }>
  markers?: Array<{
    id: string
    timeMs: number
    label: string
    color: string
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
  /** Session state — persisted so user resumes where they left off */
  playheadMs?: number
  zoom?: number
  masterVolume?: number
  loopEnabled?: boolean
}

/** req 2.21 — Deterministic 8-char content hash for temp caption filenames */
function captionContentHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 8)
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
      options?: ExportSRTOptions,
      jobId?: string
    ) => {
      try {
        const os = require('os')
        const path = require('path')
        const tmpDir = path.join(os.tmpdir(), 'capcraft')

        if (!existsSync(tmpDir)) {
          await mkdir(tmpDir, { recursive: true })
        }

        const hash = captionContentHash({ entries, options: options ?? {} })
        const suffix = jobId ? `_${jobId}` : ''
        const srtPath = join(tmpDir, `temp_captions_${hash}${suffix}.srt`)
        const srtContent = generateExportSRT(entries, options ?? {})

        await writeFile(srtPath, srtContent, 'utf-8')
        return srtPath
      } catch (err) {
        throw new Error(`Failed to create temp SRT: ${(err as Error).message}`)
      }
    }
  )

  ipcMain.handle(
    'project:createTempASS',
    async (
      _event,
      entries: Array<{
        startMs: number
        endMs: number
        text: string
        words?: Array<{ word: string; startMs: number; endMs: number }>
        style?: ExportCaptionStyle
      }>,
      options: ExportASSOptions,
      jobId?: string
    ) => {
      try {
        const os = require('os')
        const path = require('path')
        const tmpDir = path.join(os.tmpdir(), 'capcraft')

        if (!existsSync(tmpDir)) {
          await mkdir(tmpDir, { recursive: true })
        }

        const hash = captionContentHash({ entries, options })
        const suffix = jobId ? `_${jobId}` : ''
        const assPath = join(tmpDir, `temp_captions_${hash}${suffix}.ass`)
        const assContent = generateExportASS(entries, options)

        await writeFile(assPath, assContent, 'utf-8')
        return assPath
      } catch (err) {
        throw new Error(`Failed to create temp ASS: ${(err as Error).message}`)
      }
    }
  )
}
