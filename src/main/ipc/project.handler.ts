import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { join, basename } from 'path'
import { existsSync } from 'fs'
import { createHash, randomUUID } from 'crypto'
import {
  generateSRT,
  generateExportSRT,
  generateExportASS,
  type ExportSRTOptions,
  type ExportASSOptions,
  type ExportCaptionStyle
} from '../../shared/utils/srt'
import {
  validateProjectFile,
  validateClipzuFile,
  validateExportConfig,
  migrateV1ToClipzuStrict,
  formatValidationErrors,
  MAX_PROJECT_FILE_BYTES,
  CLIPZU_FORMAT_VERSION,
  PROJECT_FORMAT_VERSION,
  type LoadedProjectFile,
  type NormalizedProjectFile,
  type ClipzuDocument,
} from '../../shared/project/projectSchema'
import { v1ToLoadedProject } from '../../shared/project/legacyEcp'
import { mediaDialogFilters } from '../../shared/media/extensions'
import { vouchMediaFiles } from '../security/fileAccess'
import {
  formatMissingMediaError,
  type RelinkListResult,
  type RelinkMissingEntry,
} from '../../shared/project/relink'
import { stripBOM } from '../../shared/utils/encoding'
import {
  PROJECT_SAVE_CHANNEL,
  PROJECT_LOAD_CHANNEL,
  PROJECT_LOAD_PATH_CHANNEL,
  PROJECT_EXPORT_SRT_CHANNEL,
  PROJECT_CREATE_TEMP_SRT_CHANNEL,
  PROJECT_CREATE_TEMP_ASS_CHANNEL,
  PROJECT_RELINK_LIST_CHANNEL,
  PROJECT_RELINK_LOCATE_CHANNEL,
  PROJECT_RELINK_SCAN_CHANNEL,
  PROJECT_RELINK_RETRY_CHANNEL,
  PROJECT_RELINK_CANCEL_CHANNEL,
  type ProjectLoadResult,
} from '../../shared/ipc/channels'
import {
  buildAssetManifest,
  resolveAssetManifest,
  projectDirForFile,
  scanFolderForMissing,
  MissingMediaError,
} from '../project/projectAssets'
import { atomicSave } from '../project/saveCoordinator'

/**
 * Canonical project shape. Authoritative definition lives in
 * src/shared/project/projectSchema.ts (validateProjectFile); the handlers
 * below NEVER trust raw input — every save/load payload is validated and
 * normalized through it first. (The old local `ProjectFile` interface was
 * removed: it described keyframes/modifiers shapes the app never produces,
 * which is exactly the drift this schema fixes. See audit section 2.5.)
 */

/** req 2.21 — Deterministic 8-char content hash for temp caption filenames */
function captionContentHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 8)
}

// ---------------------------------------------------------------------------
// Missing-media relink sessions (protocol in shared/project/relink.ts)
// ---------------------------------------------------------------------------
// A failed load stashes { filePath, overrides, missing } under a one-time
// token and throws `MISSING_MEDIA:<token>\n<detail>` — Electron IPC
// rejections only carry `message`, so structured data rides in the message.
// The RelinkDialog drives locate/scan/retry against the token. Sessions are
// capped and evicted oldest-first (no unbounded growth, no leak on abandon).

interface RelinkSession {
  filePath: string
  format: 'clipzu' | 'ecp-legacy'
  overrides: Map<string, string>
  missing: RelinkMissingEntry[]
}

const pendingRelinkSessions = new Map<string, RelinkSession>()
const MAX_PENDING_RELINK = 4

type LoadAttempt =
  | { ok: true; result: ProjectLoadResult }
  | { ok: false; format: 'clipzu' | 'ecp-legacy'; missing: RelinkMissingEntry[] }

async function fileIsFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

function legacyUsageId(kind: 'clip' | 'audio', id: string): string {
  return `${kind}:${id}`
}

/** Build the renderer-facing loaded shape from a validated .clipzu document. */
function buildLoadedFromClipzu(
  document: ClipzuDocument,
  resolved: ReadonlyMap<string, string>
): LoadedProjectFile {
  // Inject live absolute paths; strip assetId (renderer Clip has no such
  // field — exact shape, no extra keys smuggled into stores).
  // (.clipzu never stores proxyPath, so there is no stale cache to check.)
  const clips = document.timeline.clips.map((clip) => {
    const { assetId: _assetId, ...rest } = clip
    void _assetId
    return { ...rest, path: resolved.get(clip.assetId) as string }
  })
  const audioTracks = document.timeline.audioTracks.map((track) => {
    const { assetId: _assetId, ...rest } = track
    void _assetId
    return { ...rest, path: resolved.get(track.assetId) as string }
  })
  return {
    version: CLIPZU_FORMAT_VERSION,
    name: document.metadata.name,
    fps: document.metadata.fps,
    resolution: { ...document.metadata.resolution },
    aspectRatio: document.metadata.aspectRatio,
    backgroundColor: document.metadata.backgroundColor,
    clips: clips as LoadedProjectFile['clips'],
    audioTracks: audioTracks as LoadedProjectFile['audioTracks'],
    textClips: document.timeline.textClips.map((tc) => ({ ...tc })),
    tracks: document.tracks.map((t) => ({ ...t })),
    markers: document.timeline.markers.map((m) => ({ ...m })),
    captions: {
      entries: document.captions.entries.map((tc) => ({ ...tc })),
      style: { ...(document.captions.style as object) } as LoadedProjectFile['captions']['style'],
      language: document.captions.language,
    },
    playheadMs: document.settings.playheadMs,
    zoom: document.settings.zoom,
    masterVolume: document.settings.masterVolume,
    loopEnabled: document.settings.loopEnabled,
    exportConfig: { ...document.exportConfig },
  }
}

/**
 * Read + validate + resolve a project at a KNOWN path, applying relink
 * overrides. Pure of session state: returns either the loaded result or the
 * complete missing set. Throws only on corruption/unreadable/unsupported
 * version (never on missing media).
 */
async function attemptLoadProject(
  filePath: string,
  overrides: ReadonlyMap<string, string>
): Promise<LoadAttempt> {
  const projectDir = projectDirForFile(filePath)
  const rawContent = await readFile(filePath, 'utf-8')
  // UTF-8 BYTE length (Phase 9): `.length` under-reports CJK/emoji 2-4x.
  const byteLength = Buffer.byteLength(rawContent, 'utf8')
  if (byteLength > MAX_PROJECT_FILE_BYTES) {
    throw new Error(
      `project file exceeds size limit (${byteLength} > ${MAX_PROJECT_FILE_BYTES} bytes)`
    )
  }
  // A stray BOM (foreign editor) must not fail the parse.
  const raw = JSON.parse(stripBOM(rawContent)) as unknown
  const version =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)['version']
      : undefined

  if (version !== CLIPZU_FORMAT_VERSION && version !== PROJECT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported project version: ${JSON.stringify(version)} (expected "${CLIPZU_FORMAT_VERSION}" or legacy "${PROJECT_FORMAT_VERSION}")`
    )
  }

  if (version === PROJECT_FORMAT_VERSION) {
    // Legacy CapCraft .ecp (v1, absolute paths). Overrides key per entity.
    const legacy = validateProjectFile(raw)
    if (!legacy.ok || !legacy.data) {
      throw new Error(`Legacy project file is corrupted: ${formatValidationErrors(legacy)}`)
    }
    const v1 = legacy.data
    const usages = [
      ...v1.clips.map((c) => ({ id: legacyUsageId('clip', c.id), path: c.path })),
      ...v1.audioTracks.map((t) => ({ id: legacyUsageId('audio', t.id), path: t.path })),
    ]
    const missing: RelinkMissingEntry[] = []
    const pathByUsageId = new Map<string, string>()
    for (const usage of usages) {
      const override = overrides.get(usage.id)
      const candidate = override ?? usage.path
      if (await fileIsFile(candidate)) {
        pathByUsageId.set(usage.id, candidate)
      } else {
        missing.push({
          id: usage.id,
          filename: basename(usage.path),
          expected: override ? [override, usage.path] : [usage.path],
        })
      }
    }
    if (missing.length > 0) {
      return { ok: false, format: 'ecp-legacy', missing }
    }
    const patched: NormalizedProjectFile = {
      ...v1,
      clips: v1.clips.map((c) => ({ ...c, path: pathByUsageId.get(legacyUsageId('clip', c.id)) ?? c.path })),
      audioTracks: v1.audioTracks.map((t) => ({ ...t, path: pathByUsageId.get(legacyUsageId('audio', t.id)) ?? t.path })),
    }
    const notes: string[] = [
      'Opened legacy CapCraft (.ecp) project — Save (Ctrl+S) migrates it to .clipzu with portable asset paths.',
      ...legacy.warnings,
    ]
    const loaded = v1ToLoadedProject(patched, notes)
    // P6.2: resolved legacy media (incl. relink overrides) is servable.
    vouchMediaFiles(pathByUsageId.values())
    return { ok: true, result: { data: loaded, filePath, format: 'ecp-legacy', migrationNotes: notes } }
  }

  const migrationNotes: string[] = []
  const validation = validateClipzuFile(raw)
  if (!validation.ok || !validation.data) {
    throw new Error(`Project file is corrupted: ${formatValidationErrors(validation)}`)
  }
  const document = validation.data
  migrationNotes.push(...validation.warnings)

  let resolved: Map<string, string>
  try {
    const r = await resolveAssetManifest(document.assets, projectDir, overrides)
    resolved = r.resolved
    migrationNotes.push(...r.notes)
  } catch (err) {
    if (err instanceof MissingMediaError) {
      return {
        ok: false,
        format: 'clipzu',
        missing: err.missing.map((m) => ({ id: m.id, filename: m.filename, expected: m.expected })),
      }
    }
    throw err
  }

  const loaded = buildLoadedFromClipzu(document, resolved)
  // P6.2: resolved manifest assets (incl. relink overrides) are servable.
  vouchMediaFiles(resolved.values())
  return { ok: true, result: { data: loaded, filePath, format: 'clipzu', migrationNotes } }
}

function stashRelinkSession(
  filePath: string,
  format: 'clipzu' | 'ecp-legacy',
  overrides: Map<string, string>,
  missing: RelinkMissingEntry[]
): string {
  const token = randomUUID()
  if (pendingRelinkSessions.size >= MAX_PENDING_RELINK) {
    const oldest = pendingRelinkSessions.keys().next().value
    if (oldest !== undefined) pendingRelinkSessions.delete(oldest)
  }
  pendingRelinkSessions.set(token, {
    filePath,
    format,
    overrides: new Map(overrides),
    missing,
  })
  return token
}

async function loadProjectAtPath(
  filePath: string,
  overrides: Map<string, string>,
  existingToken?: string
): Promise<ProjectLoadResult> {
  const attempt = await attemptLoadProject(filePath, overrides)
  if (attempt.ok) {
    if (existingToken) pendingRelinkSessions.delete(existingToken)
    return attempt.result
  }
  const token =
    existingToken !== undefined && pendingRelinkSessions.has(existingToken)
      ? existingToken
      : stashRelinkSession(filePath, attempt.format, overrides, attempt.missing)
  const session = pendingRelinkSessions.get(token)
  if (session) {
    session.missing = attempt.missing
    session.format = attempt.format
  }
  // Detail is human-readable; the token is the machine handle.
  const detail = new MissingMediaError(attempt.missing).message
  throw new Error(formatMissingMediaError(token, detail))
}

function requireRelinkSession(token: unknown): RelinkSession {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Invalid relink session token')
  }
  const session = pendingRelinkSessions.get(token)
  if (!session) {
    throw new Error('Relink session expired — reopen the project to try again.')
  }
  return session
}

function relinkList(session: RelinkSession): RelinkListResult {
  return {
    projectFile: session.filePath,
    format: session.format,
    missing: session.missing.map((m) => ({ ...m, expected: [...m.expected] })),
  }
}

/** Re-probe every asset against current overrides; updates the session. */
async function recomputeRelinkMissing(session: RelinkSession): Promise<void> {
  const attempt = await attemptLoadProject(session.filePath, session.overrides)
  if (attempt.ok) {
    session.missing = []
    session.format = attempt.result.format
  } else {
    session.missing = attempt.missing
    session.format = attempt.format
  }
}

/**
 * Media file filters shared by locate dialogs.
 * SSOT lives in `src/shared/media/extensions.ts` (P1.4) — the dialog
 * label differs ("Media") but the extension set must stay identical.
 */
const MEDIA_FILTERS = (() => {
  const [media, all] = mediaDialogFilters()
  return [
    { name: 'Media', extensions: media.extensions },
    all,
  ]
})()

export function registerProjectHandler(getWindow: () => BrowserWindow | null): void {
  // Save project as .clipzu (v2 envelope). Write path is .clipzu ONLY.
  // An explicit non-.clipzu destination is a caller bug and throws — main
  // never writes foreign extensions and never silently redirects. Every
  // failure below throws — no partial files, no silent downgrade. (Atomic
  // tmp+rename is a later step; the write itself is intact or the error
  // propagates.)
  ipcMain.handle(PROJECT_SAVE_CHANNEL, async (_event, projectData: unknown, filePath?: string) => {
    const validation = validateProjectFile(projectData)
    if (!validation.ok || !validation.data) {
      throw new Error(`Project validation failed: ${formatValidationErrors(validation)}`)
    }
    const v1 = validation.data

    const exportValidation = validateExportConfig(
      (projectData as Record<string, unknown>)['exportConfig']
    )
    if (!exportValidation.ok || !exportValidation.data) {
      throw new Error(
        `Export config validation failed: ${formatValidationErrors(exportValidation)}`
      )
    }

    const win = getWindow()

    // Resolve the destination FIRST: the manifest's relative paths are rooted
    // at the .clipzu file directory, so the path must be known before build.
    let savePath = filePath
    if (
      typeof savePath === 'string' &&
      !savePath.toLowerCase().endsWith('.clipzu')
    ) {
      throw new Error(
        `Refusing to save: destination must end with .clipzu, got "${savePath}"`
      )
    }
    if (!savePath) {
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        defaultPath: `${v1.name || 'project'}.clipzu`,
        filters: [
          { name: 'Clipzu Project', extensions: ['clipzu'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePath) return null
      savePath = result.filePath
    }
    const projectDir = projectDirForFile(savePath)

    // Manifest build throws on any missing/unreadable media: nothing is
    // written when references dangle.
    const usages = [
      ...v1.clips.map((clip) => ({ path: clip.path, sourceDurationMs: clip.sourceDurationMs })),
      ...v1.audioTracks.map((track) => ({ path: track.path, sourceDurationMs: track.sourceDurationMs })),
    ]
    const { assets, pathToAssetId } = await buildAssetManifest(usages, projectDir)

    const migration = migrateV1ToClipzuStrict(
      v1,
      assets,
      pathToAssetId,
      app.getVersion(),
      exportValidation.data,
      []
    )
    if (!migration.ok || !migration.document) {
      throw new Error(
        `Project migration to .clipzu failed: ${migration.errors
          .slice(0, 8)
          .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
          .join('; ')}`
      )
    }

    // Defense in depth: the freshly built document must pass strict v2
    // validation. A failure here is a builder bug — loud, never written.
    const finalCheck = validateClipzuFile(migration.document as unknown)
    if (!finalCheck.ok || !finalCheck.data) {
      throw new Error(
        `Built .clipzu document failed validation (builder bug): ${formatValidationErrors(finalCheck)}`
      )
    }

    try {
      // Atomic durable write (Phase 4): temp + fsync + rename through the
      // per-path single-flight coordinator. Ctrl+S spam and autosave overlap
      // coalesce to the latest bytes; a crash leaves old-complete or
      // new-complete, never half-written.
      await atomicSave(savePath, JSON.stringify(finalCheck.data, null, 2))
      return savePath
    } catch (err) {
      throw new Error(`Failed to save project: ${(err as Error).message}`)
    }
  })

  // Load a project via the OS open dialog. Accepts native .clipzu (v2) and
  // legacy CapCraft .ecp (v1). Resolution is ALL-OR-NOTHING: any unresolvable
  // asset aborts with a relink token so the renderer can offer one-click
  // recovery. Nothing is returned half-resolved — ever.
  ipcMain.handle(PROJECT_LOAD_CHANNEL, async () => {
    const win = getWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Clipzu Project', extensions: ['clipzu'] },
        { name: 'CapCraft Legacy Project', extensions: ['ecp'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return loadProjectAtPath(result.filePaths[0], new Map())
  })

  // Load a KNOWN project path (relink retry, recent files). No dialog.
  ipcMain.handle(PROJECT_LOAD_PATH_CHANNEL, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('project:loadPath requires a non-empty file path')
    }
    return loadProjectAtPath(filePath, new Map())
  })

  // ---- Missing-media relink session handlers ------------------------------

  ipcMain.handle(PROJECT_RELINK_LIST_CHANNEL, async (_event, token: unknown): Promise<RelinkListResult> => {
    return relinkList(requireRelinkSession(token))
  })

  ipcMain.handle(
    PROJECT_RELINK_LOCATE_CHANNEL,
    async (_event, token: unknown, assetId: unknown): Promise<RelinkListResult> => {
      const session = requireRelinkSession(token)
      if (typeof assetId !== 'string' || assetId.length === 0) {
        throw new Error('project:relink:locate requires an asset id')
      }
      const win = getWindow()
      if (!win) return relinkList(session)
      const entry = session.missing.find((m) => m.id === assetId)
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        defaultPath: entry?.expected[0] ?? entry?.filename,
        filters: MEDIA_FILTERS,
      })
      if (result.canceled || result.filePaths.length === 0) return relinkList(session)
      session.overrides.set(assetId, result.filePaths[0])
      await recomputeRelinkMissing(session)
      return relinkList(session)
    }
  )

  ipcMain.handle(
    PROJECT_RELINK_SCAN_CHANNEL,
    async (_event, token: unknown, folder: unknown): Promise<RelinkListResult> => {
      const session = requireRelinkSession(token)
      const win = getWindow()
      if (!win) return relinkList(session)
      let dir: string | null = typeof folder === 'string' && folder.length > 0 ? folder : null
      if (dir === null) {
        const result = await dialog.showOpenDialog(win, {
          properties: ['openDirectory'],
          title: 'Choose the folder that contains the missing media',
        })
        if (result.canceled || result.filePaths.length === 0) return relinkList(session)
        dir = result.filePaths[0]
      }
      const found = await scanFolderForMissing(dir, session.missing)
      for (const [id, foundPath] of found) {
        session.overrides.set(id, foundPath)
      }
      await recomputeRelinkMissing(session)
      return relinkList(session)
    }
  )

  ipcMain.handle(PROJECT_RELINK_RETRY_CHANNEL, async (_event, token: unknown) => {
    const session = requireRelinkSession(token)
    return loadProjectAtPath(session.filePath, session.overrides, token as string)
  })

  ipcMain.handle(PROJECT_RELINK_CANCEL_CHANNEL, async (_event, token: unknown) => {
    if (typeof token === 'string') pendingRelinkSessions.delete(token)
    return { success: true }
  })

  // Export SRT sidecar file
  ipcMain.handle(
    PROJECT_EXPORT_SRT_CHANNEL,
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
    PROJECT_CREATE_TEMP_SRT_CHANNEL,
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
        const tmpDir = path.join(os.tmpdir(), 'clipzu')

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
    PROJECT_CREATE_TEMP_ASS_CHANNEL,
    async (
      _event,
      entries: Array<{
        startMs: number
        endMs: number
        text: string
        words?: Array<{ word: string; startMs: number; endMs: number }>
        style?: ExportCaptionStyle
        fadeInMs?: number
        fadeOutMs?: number
        /** P2.4 stacked-lane ASS layer (lower caption lane → higher layer). */
        layer?: number
      }>,
      options: ExportASSOptions,
      jobId?: string
    ) => {
      try {
        const os = require('os')
        const path = require('path')
        const tmpDir = path.join(os.tmpdir(), 'clipzu')

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
