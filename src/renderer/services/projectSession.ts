import { useTimeline, clearStyleClipboard } from '../store/useTimeline'
import { useProject, type AspectRatio } from '../store/useProject'
import { useCaption } from '../store/useCaption'
import { useExport } from '../store/useExport'
import { useToast } from '../store/useToast'
import { useRelink } from '../store/useRelink'
import type { ProjectLoadResult } from '../../shared/ipc/channels'
import { invokeLoadProject } from '../ipc/projectIpc'

/**
 * projectSession — SSOT for "a loaded project -> live stores" orchestration.
 *
 * Used by both the native/hotkey load path (loadProjectFromDialog) and the
 * relink dialog's successful retry. Previously this logic lived inline in
 * HotkeyManager; extracting it means relink recovery restores state through
 * exactly the same reset+hydrate sequence — no drift, no second copy.
 *
 * Reset order is contractual (task.txt Phase 6): RESET every session surface
 * FIRST, then restore. Nothing from the previous project may survive.
 */
export function applyLoadedProject(result: ProjectLoadResult): void {
  const { data, filePath, migrationNotes } = result

  useTimeline.getState().clearTimeline()
  clearStyleClipboard()
  useCaption.getState().resetCaptionSession()
  useExport.getState().resetExportSession()

  useProject.getState().loadProject({
    name: data.name,
    fps: data.fps,
    resolution: data.resolution,
    // Main strict-validates aspectRatio against the same enum; the cast
    // bridges LoadedProjectFile's string to the store's union type.
    aspectRatio: data.aspectRatio as AspectRatio,
    backgroundColor: data.backgroundColor,
    projectFilePath: filePath,
  })
  useTimeline.getState().loadTimeline({
    clips: data.clips,
    audioTracks: data.audioTracks,
    // Single source of truth: textClips via timeline (captions.entries is
    // validated deep-equal in main and carries no independent state).
    textClips: data.textClips,
    tracks: data.tracks,
    markers: data.markers,
    playheadMs: data.playheadMs,
    zoom: data.zoom,
    masterVolume: data.masterVolume,
    loopEnabled: data.loopEnabled,
  })
  useCaption.getState().loadCaptions({
    entries: [],
    style: data.captions.style,
    language: data.captions.language || 'en',
  })
  useExport.getState().loadExportConfig(data.exportConfig)

  for (const note of migrationNotes) {
    useToast.getState().info(note)
  }
  useToast.getState().success('Project loaded')
}

/**
 * Single-flight guard: double Ctrl+O / menu+hotkey races used to fire
 * parallel open dialogs whose completions applied in arrival order.
 */
let loadInFlight = false

/**
 * Open a project: show the dialog, apply on success, and route missing-media
 * failures into the one-click relink dialog instead of a dead-end toast.
 */
export async function loadProjectFromDialog(): Promise<void> {
  if (loadInFlight) return
  loadInFlight = true
  try {
    const result = await invokeLoadProject()
    if (!result) return
    applyLoadedProject(result)
  } catch (err) {
    const message = (err as Error).message
    // Missing media -> relink dialog (it fetches the structured list itself).
    if (useRelink.getState().openFromError(message)) return
    console.error('Load failed:', err)
    useToast.getState().error(`Load failed: ${message}`)
  } finally {
    loadInFlight = false
  }
}
