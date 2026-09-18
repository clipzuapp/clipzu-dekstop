import { useEffect, useRef } from 'react'
import { useTimeline, clearStyleClipboard, performUndo, performRedo } from '../store/useTimeline'
import { useProject } from '../store/useProject'
import { useCaption } from '../store/useCaption'
import { useExport } from '../store/useExport'
import { useToast } from '../store/useToast'
import { usePreviewView } from '../store/usePreviewView'
import { useMediaLibrary } from '../store/useMediaLibrary'
import type { LeftTabId } from './LeftRail/index'
import {
  MENU,
  type ProjectSavePayload,
} from '../../shared/ipc/channels'
import { invokeSaveProject } from '../ipc/projectIpc'
import { loadProjectFromDialog } from '../services/projectSession'

/**
 * HotkeyManager - Global keyboard shortcut handler
 * Implements all required hotkeys per specification
 * Uses refs for frequently-changing values to avoid re-registering
 * the keydown listener on every frame during playback.
 */

type ActiveTool = 'select' | 'blade' | 'hand' | 'zoom'

interface HotkeyManagerProps {
  onExport: () => void
  onShortcuts?: () => void
  activeTool?: ActiveTool
  setActiveTool?: (tool: ActiveTool) => void
  onAddText?: () => void
  /** Which left panel tab is currently active (for context-aware Ctrl+A) */
  activeLeftTab?: LeftTabId
}

/**
 * Serialize and save the current project to disk (.clipzu). SSOT — used by
 * both Ctrl+S manual save and the auto-save interval.
 * Main validates strictly, builds the asset manifest, migrates to the v2
 * envelope, and writes .clipzu ONLY.
 * @param forceDialog - if true, always show save dialog (Save As behavior)
 */
function saveProjectToDisk(options?: { forceDialog?: boolean }): Promise<string | null> {
  const project = useProject.getState()
  const captionData = useCaption.getState()
  const exportData = useExport.getState()
  const timeline = useTimeline.getState()

  // When forceDialog is true, pass undefined as filePath so the IPC handler
  // always shows the save dialog (Save As behavior).
  const ipcFilePath = options?.forceDialog ? undefined : project.projectFilePath

  // Typed contract (shared/ipc/channels): main strict-validates at runtime.
  const payload: ProjectSavePayload = {
    version: '1.0',
    name: project.name,
    fps: project.fps,
    resolution: project.resolution,
    aspectRatio: project.aspectRatio,
    backgroundColor: project.backgroundColor,
    clips: timeline.clips,
    audioTracks: timeline.audioTracks,
    textClips: timeline.textClips,
    tracks: timeline.tracks,
    markers: timeline.markers,
    // Session state — restored on load so user picks up where they left off
    playheadMs: timeline.playheadMs,
    zoom: timeline.zoom,
    masterVolume: timeline.masterVolume,
    loopEnabled: timeline.loopEnabled,
    captions: {
      entries: timeline.textClips,
      style: captionData.activeStyle,
      language: captionData.language
    },
    exportPreset: exportData.preset,
    // Full export configuration for the v2 envelope (strict-validated in main).
    exportConfig: {
      preset: exportData.preset,
      customWidth: exportData.customWidth,
      customHeight: exportData.customHeight,
      upscaleEnabled: exportData.upscaleEnabled,
      upscaleAlgorithm: exportData.upscaleAlgorithm,
      codec: exportData.codec,
      qualityPreset: exportData.qualityPreset,
      bitrateKbps: exportData.bitrateKbps,
      bitrateMode: exportData.bitrateMode,
      exportFrameRange: exportData.exportFrameRange,
      audioOnly: exportData.audioOnly,
      fps: exportData.fps,
      hardwareAccel: exportData.hardwareAccel
    }
  }

  return invokeSaveProject(payload, ipcFilePath)
}

export function HotkeyManager({ onExport, onShortcuts, activeTool: _activeTool, setActiveTool, onAddText, activeLeftTab }: HotkeyManagerProps): null {
  const isPlaying = useTimeline((s) => s.isPlaying)
  const playheadMs = useTimeline((s) => s.playheadMs)
  const totalDurationMs = useTimeline((s) => s.totalDurationMs)
  const setPlaying = useTimeline((s) => s.setPlaying)
  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const splitClipAtPlayhead = useTimeline((s) => s.splitClipAtPlayhead)

  // Keep refs in sync for stable event handler (avoids re-registering on every frame)
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const playheadMsRef = useRef(playheadMs)
  playheadMsRef.current = playheadMs
  const totalDurationMsRef = useRef(totalDurationMs)
  totalDurationMsRef.current = totalDurationMs

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Ignore if typing in input/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return
      }

      const isMod = e.ctrlKey || e.metaKey
      const fps = useProject.getState().fps
      const frameMs = 1000 / fps

      // Space: play/pause
      if (e.code === 'Space' && !isMod) {
        e.preventDefault()
        setPlaying(!isPlayingRef.current)
        return
      }

      // J: rewind (skip back 5s)
      if (e.key === 'j' && !isMod) {
        e.preventDefault()
        setPlayhead(Math.max(0, playheadMsRef.current - 5000))
        return
      }

      // K: pause
      if (e.key === 'k' && !isMod) {
        e.preventDefault()
        setPlaying(false)
        return
      }

      // L: forward (skip 5s)
      if (e.key === 'l' && !isMod && !e.shiftKey) {
        e.preventDefault()
        setPlayhead(Math.min(totalDurationMsRef.current, playheadMsRef.current + 5000))
        return
      }

      // Shift+L: toggle loop playback
      if (e.key === 'L' && !isMod && e.shiftKey) {
        e.preventDefault()
        useTimeline.getState().toggleLoop()
        const loopOn = useTimeline.getState().loopEnabled
        useToast.getState().info(loopOn ? 'Loop ON' : 'Loop OFF')
        return
      }

      // S: split clip at playhead
      if (e.key === 's' && !isMod) {
        e.preventDefault()
        splitClipAtPlayhead()
        return
      }

      // M: toggle mute on focused audio track
      if (e.key === 'm' && !isMod) {
        e.preventDefault()
        const state = useTimeline.getState()
        const focusedId = state.focusedId
        if (focusedId && state.audioTracks.some((a) => a.id === focusedId)) {
          state.toggleAudioMute(focusedId)
        }
        return
      }

      // Shift+S: toggle solo on focused audio track's parent lane (plain s = split)
      if (e.key === 'S' && !isMod && e.shiftKey) {
        e.preventDefault()
        const state = useTimeline.getState()
        const focusedId = state.focusedId
        if (focusedId) {
          const audioTrack = state.audioTracks.find((a) => a.id === focusedId)
          if (audioTrack) {
            const parentTrack = state.tracks.find(
              (t) => t.kind === 'audio' && t.index === audioTrack.trackIndex
            )
            if (parentTrack) state.toggleSoloTrack(parentTrack.id)
          }
        }
        return
      }

      // Delete/Backspace: delete selected (immediate, no confirm — CapCut parity)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useTimeline.getState()
        const hasClipSelection = state.selectedIds.some((id) => state.clips.some((c) => c.id === id))
        const hasTextSelection = state.selectedIds.some((id) => state.textClips.some((tc) => tc.id === id))

        if (hasClipSelection || hasTextSelection) {
          e.preventDefault()
          useTimeline.getState().deleteSelected()
        }
        return
      }

      // Ctrl+Z: undo (capture-apply centralized in performUndo so the
      // toolbar buttons and hotkeys share one correct implementation).
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        performUndo()
        return
      }

      // Ctrl+Shift+Z / Ctrl+Y: redo (mirror image).
      if (isMod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault()
        performRedo()
        return
      }

      // Ctrl+Shift+S: save project as (always show dialog)
      if (isMod && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        saveProjectToDisk({ forceDialog: true })
          .then((savedPath) => {
            // Cancelled dialog (null) keeps the project dirty — marking clean
            // here used to lose the close-guard prompt (data-loss bug).
            if (!savedPath) return
            useProject.getState().setProjectFilePath(savedPath)
            useProject.getState().markClean()
            useToast.getState().success('Project saved as ' + (savedPath?.split(/[\\/]/).pop() ?? ''))
          })
          .catch((err: Error) => {
            console.error('Save As failed:', err)
            useToast.getState().error(`Save As failed: ${err.message}`)
          })
        return
      }

      // Ctrl+S: save project (reuse existing path, or show dialog if first save)
      if (isMod && e.key === 's') {
        e.preventDefault()
        saveProjectToDisk()
          .then((savedPath) => {
            if (!savedPath) return
            useProject.getState().setProjectFilePath(savedPath)
            useProject.getState().markClean()
            useToast.getState().success('Project saved')
          })
          .catch((err: Error) => {
            console.error('Save failed:', err)
            useToast.getState().error(`Save failed: ${err.message}`)
          })
        return
      }

      // Ctrl+N: new project
      if (isMod && e.key === 'n') {
        e.preventDefault()
        useProject.getState().newProject()
        useTimeline.getState().clearTimeline()
        clearStyleClipboard()
        useCaption.getState().resetCaptionSession()
        useExport.getState().resetExportSession()
        useToast.getState().success('New project created')
        return
      }

      // Ctrl+O: load project (SSOT — delegates to shared function)
      if (isMod && e.key === 'o') {
        e.preventDefault()
        loadProjectFromDialog()
        return
      }

      // Ctrl+E: open export dialog
      if (isMod && e.key === 'e') {
        e.preventDefault()
        onExport()
        return
      }

      // Ctrl+C: copy selection
      if (isMod && e.key === 'c') {
        e.preventDefault()
        useTimeline.getState().copySelection()
        useToast.getState().info('Copied')
        return
      }

      // Ctrl+X: cut selection
      if (isMod && e.key === 'x') {
        e.preventDefault()
        useTimeline.getState().cutSelection()
        useToast.getState().info('Cut')
        return
      }

      // Ctrl+V: paste at playhead
      if (isMod && e.key === 'v') {
        e.preventDefault()
        useTimeline.getState().pasteAtPlayhead()
        useToast.getState().info('Pasted')
        return
      }

      // Ctrl+D: duplicate selected
      if (isMod && e.key === 'd') {
        e.preventDefault()
        const state = useTimeline.getState()
        const clipSelectionCount = state.selectedIds.filter((id) => state.clips.some((c) => c.id === id)).length
        if (clipSelectionCount > 1) {
          useTimeline.getState().duplicateSelected()
        } else {
          const focusedId = state.focusedId
          if (focusedId && state.clips.some((c) => c.id === focusedId)) useTimeline.getState().duplicateClip(focusedId)
        }
        return
      }

      // Escape: deselect all (timeline + media library)
      if (e.key === 'Escape') {
        useTimeline.getState().deselectAll()
        useMediaLibrary.getState().deselectAll()
        return
      }

      // Ctrl+A: select all (context-aware: media library vs timeline)
      if (isMod && e.key === 'a') {
        e.preventDefault()
        if (activeLeftTab === 'media') {
          useMediaLibrary.getState().selectAll()
        } else {
          useTimeline.getState().selectAll()
        }
        return
      }

      // Arrow keys: frame-accurate seeking
      if (e.key === 'ArrowLeft' && !isMod) {
        e.preventDefault()
        const step = e.shiftKey ? 1000 : frameMs
        setPlayhead(Math.max(0, playheadMsRef.current - step))
        return
      }
      if (e.key === 'ArrowRight' && !isMod) {
        e.preventDefault()
        const step = e.shiftKey ? 1000 : frameMs
        setPlayhead(Math.min(totalDurationMsRef.current, playheadMsRef.current + step))
        return
      }

      // Home/End: jump to start/end
      if (e.key === 'Home' && !isMod) {
        e.preventDefault()
        setPlayhead(0)
        return
      }
      if (e.key === 'End' && !isMod) {
        e.preventDefault()
        setPlayhead(totalDurationMsRef.current)
        return
      }

      // I: set in point
      if (e.key === 'i' && !isMod) {
        e.preventDefault()
        useTimeline.getState().setInPoint(playheadMsRef.current)
        useToast.getState().info(`In point set at ${Math.round(playheadMsRef.current)}ms`)
        return
      }

      // O: set out point
      if (e.key === 'o' && !isMod) {
        e.preventDefault()
        useTimeline.getState().setOutPoint(playheadMsRef.current)
        useToast.getState().info(`Out point set at ${Math.round(playheadMsRef.current)}ms`)
        return
      }

      // T: add text
      if (e.key === 't' && !isMod && onAddText) {
        e.preventDefault()
        onAddText()
        return
      }

      // ?: show keyboard shortcuts
      if (e.key === '?' && !isMod && onShortcuts) {
        e.preventDefault()
        onShortcuts()
        return
      }

      // Tool hotkeys: V / B / H / Z
      if (!isMod && setActiveTool) {
        if (e.key === 'v' || e.key === 'V') { e.preventDefault(); setActiveTool('select'); return }
        if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setActiveTool('blade'); return }
        if (e.key === 'h' || e.key === 'H') { e.preventDefault(); setActiveTool('hand'); return }
        // Z only for zoom tool when not Ctrl (Ctrl+Z is undo)
        if ((e.key === 'z' || e.key === 'Z') && !isMod) { e.preventDefault(); setActiveTool('zoom'); return }
      }

      // ---- Preview zoom hotkeys ----
      // Ctrl+= : zoom in
      if (isMod && (e.key === '=' || e.key === '+') && !e.shiftKey) {
        e.preventDefault()
        usePreviewView.getState().zoomIn()
        return
      }
      // Ctrl+- : zoom out
      if (isMod && e.key === '-' && !e.shiftKey) {
        e.preventDefault()
        usePreviewView.getState().zoomOut()
        return
      }
      // Ctrl+0 : reset to Fit
      if (isMod && e.key === '0') {
        e.preventDefault()
        usePreviewView.getState().resetZoom()
        return
      }
      // Ctrl+Shift+F : toggle fullscreen
      if (isMod && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        usePreviewView.getState().toggleFullscreen()
        return
      }
      // Shift+G : cycle grid modes
      if (!isMod && e.shiftKey && e.key === 'G') {
        e.preventDefault()
        usePreviewView.getState().cycleGrid()
        const grid = usePreviewView.getState().guides.grid
        useToast.getState().info(`Grid: ${grid}`)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    setPlaying, setPlayhead, splitClipAtPlayhead,
    onExport, onShortcuts, setActiveTool, onAddText, activeLeftTab
  ])

  // ---------------------------------------------------------------------------
  // Auto-save + close-guard globals + native menu IPC listeners
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Expose dirty-state + save function so main process can query them via
    // executeJavaScript() when intercepting the window close event.
    // Clipzu namespace (Phase 10): main queries the same names — rename one
    // side without the other and the close guard goes blind (data loss).
    ;(window as any).__clipzu_isDirty = (): boolean => useProject.getState().isDirty
    ;(window as any).__clipzu_saveNow = (): Promise<string | null | false> => {
      return saveProjectToDisk()
        .then((savedPath) => {
          // null = user cancelled the dialog: stay dirty so the close guard
          // still prompts. Only a real path marks clean.
          if (savedPath) {
            useProject.getState().setProjectFilePath(savedPath)
            useProject.getState().markClean()
          }
          return savedPath
        })
        .catch(() => false as const)
    }

    // Auto-save every 30 seconds when project is dirty and has a file path
    const autoSaveInterval = setInterval(() => {
      const project = useProject.getState()
      if (!project.isDirty || !project.projectFilePath) return

      saveProjectToDisk()
        .then((savedPath) => {
          // Cancelled dialog (null) keeps the project dirty AND skips
          // markClean — marking clean on cancel used to lose the close-guard
          // prompt (data-loss bug). With a reused path main never cancels,
          // but the guard is free.
          if (!savedPath) return
          useProject.getState().setProjectFilePath(savedPath)
          useProject.getState().markClean()
          useToast.getState().success('Auto-saved')
        })
        .catch((err: Error) => {
          console.error('Auto-save failed:', err)
        })
    }, 30_000)

    // ---- Native menu IPC listeners ----

    const onMenuSave = (): void => {
      saveProjectToDisk()
        .then((savedPath) => {
          // Same cancel-guard as auto-save: no path, no markClean.
          if (!savedPath) return
          useProject.getState().setProjectFilePath(savedPath)
          useProject.getState().markClean()
          useToast.getState().success('Project saved')
        })
        .catch((err: Error) => {
          console.error('Save failed:', err)
          useToast.getState().error(`Save failed: ${err.message}`)
        })
    }

    const onMenuSaveAs = (): void => {
      saveProjectToDisk({ forceDialog: true })
        .then((savedPath) => {
          if (!savedPath) return
          useProject.getState().setProjectFilePath(savedPath)
          useProject.getState().markClean()
          useToast.getState().success('Project saved as ' + (savedPath?.split(/[\\/]/).pop() ?? ''))
        })
        .catch((err: Error) => {
          console.error('Save As failed:', err)
          useToast.getState().error(`Save As failed: ${err.message}`)
        })
    }

    // SSOT: delegates to shared load function (same as Ctrl+O)
    const onMenuOpen = (): void => {
      loadProjectFromDialog()
    }

    // New project: same full reset as load (no stale state may survive).
    const resetForNewProject = (): void => {
      useProject.getState().newProject()
      useTimeline.getState().clearTimeline()
      clearStyleClipboard()
      useCaption.getState().resetCaptionSession()
      useExport.getState().resetExportSession()
    }

    const onMenuNew = (): void => {
      resetForNewProject()
      useToast.getState().success('New project created')
    }

    // Store cleanup functions returned by ipcRenderer.on()
    const unsubscribers: Array<() => void> = []

    unsubscribers.push(window.electron.ipcRenderer.on(MENU.save, onMenuSave))
    unsubscribers.push(window.electron.ipcRenderer.on(MENU.saveAs, onMenuSaveAs))
    unsubscribers.push(window.electron.ipcRenderer.on(MENU.openProject, onMenuOpen))
    unsubscribers.push(window.electron.ipcRenderer.on(MENU.newProject, onMenuNew))

    return () => {
      clearInterval(autoSaveInterval)
      for (const unsub of unsubscribers) unsub()
      delete (window as any).__clipzu_isDirty
      delete (window as any).__clipzu_saveNow
    }
  }, [])

  return null
}

export default HotkeyManager
