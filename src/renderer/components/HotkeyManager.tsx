import { useEffect, useRef } from 'react'
import { useTimeline, type TextClip } from '../store/useTimeline'
import { useProject } from '../store/useProject'
import { useCaption } from '../store/useCaption'
import { useExport } from '../store/useExport'
import { useToast } from '../store/useToast'

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
  onUndo?: () => unknown
  onRedo?: () => unknown
  onAddText?: () => void
}

export function HotkeyManager({ onExport, onShortcuts, activeTool: _activeTool, setActiveTool, onUndo, onRedo, onAddText }: HotkeyManagerProps): null {
  const isPlaying = useTimeline((s) => s.isPlaying)
  const playheadMs = useTimeline((s) => s.playheadMs)
  const totalDurationMs = useTimeline((s) => s.totalDurationMs)
  const setPlaying = useTimeline((s) => s.setPlaying)
  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const splitClipAtPlayhead = useTimeline((s) => s.splitClipAtPlayhead)
  const undo = useProject((s) => s.undo)
  const redo = useProject((s) => s.redo)

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
      if (e.key === 'l' && !isMod) {
        e.preventDefault()
        setPlayhead(Math.min(totalDurationMsRef.current, playheadMsRef.current + 5000))
        return
      }

      // S: split clip at playhead
      if (e.key === 's' && !isMod) {
        e.preventDefault()
        splitClipAtPlayhead()
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

      // Ctrl+Z: undo
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const snapshot = undo()
        if (snapshot) {
          useTimeline.setState({
            clips: snapshot.clips,
            audioTracks: snapshot.audioTracks,
            textClips: snapshot.textClips
          })
        }
        return
      }

      // Ctrl+Shift+Z / Ctrl+Y: redo
      if (isMod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault()
        const snapshot = redo()
        if (snapshot) {
          useTimeline.setState({
            clips: snapshot.clips,
            audioTracks: snapshot.audioTracks,
            textClips: snapshot.textClips
          })
        }
        return
      }

      // Ctrl+S: save project
      if (isMod && e.key === 's') {
        e.preventDefault()
        const projectData = useProject.getState()
        const captionData = useCaption.getState()
        const exportData = useExport.getState()
        window.electron.ipcRenderer.invoke('project:save', {
          version: '1.0',
          name: projectData.name,
          fps: projectData.fps,
          resolution: projectData.resolution,
          clips: useTimeline.getState().clips,
          audioTracks: useTimeline.getState().audioTracks,
          captions: {
            entries: useTimeline.getState().textClips.map((tc) => ({
              id: tc.id, startMs: tc.startMs, endMs: tc.endMs, durationMs: tc.durationMs,
              trackIndex: tc.trackIndex, text: tc.text,
              style: tc.style, words: tc.words,
              sourceId: tc.sourceId, sourceType: tc.sourceType,
              transcriptionJobId: tc.transcriptionJobId
            })),
            style: captionData.activeStyle,
            language: captionData.language
          },
          exportPreset: exportData.preset
        }, projectData.projectFilePath)
          .then(() => {
            useProject.getState().markClean()
            useToast.getState().success('Project saved')
          })
          .catch((err: Error) => {
            console.error('Save failed:', err)
            useToast.getState().error(`Save failed: ${err.message}`)
          })
        return
      }

      // Ctrl+O: load project
      if (isMod && e.key === 'o') {
        e.preventDefault()
        window.electron.ipcRenderer.invoke('project:load')
          .then((result: { data: any; filePath: string } | null) => {
            if (!result) return
            const { data, filePath } = result
            useProject.getState().loadProject({
              name: data.name,
              fps: data.fps,
              resolution: data.resolution,
              projectFilePath: filePath
            })
            useTimeline.getState().loadTimeline({
              clips: data.clips || [],
              audioTracks: data.audioTracks || [],
              // entries type expanded in project.handler.ts to match TextClip — cast is structurally truthful
              textClips: (data.captions?.entries || []) as TextClip[]
            })
            useCaption.getState().loadCaptions({
              entries: data.captions?.entries || [],
              style: data.captions?.style,
              language: data.captions?.language
            })
            useToast.getState().success('Project loaded')
          })
          .catch((err: Error) => {
            console.error('Load failed:', err)
            useToast.getState().error(`Load failed: ${err.message}`)
          })
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

      // Ctrl+A: select all
      if (isMod && e.key === 'a') {
        e.preventDefault()
        useTimeline.getState().selectAll()
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
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    setPlaying, setPlayhead, splitClipAtPlayhead,
    undo, redo, onExport, onShortcuts, setActiveTool, onUndo, onRedo, onAddText
  ])

  return null
}

export default HotkeyManager
