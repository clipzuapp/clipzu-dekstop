import { useState, useEffect, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Preview } from '../components/Preview/index'
import { CaptionStrip } from '../components/Preview/CaptionStrip'
import { PlaybackControls } from '../components/Preview/PlaybackControls'
import { Timeline } from '../components/Timeline/index'
import { MediaPanel } from '../components/MediaPanel/index'
import { Inspector } from '../components/Inspector/index'
import { ExportDialog } from '../components/ExportDialog/index'
import { ConfirmDialog } from '../components/ConfirmDialog/index'
import { ShortcutsDialog } from '../components/ShortcutsDialog/index'
import { ToastContainer } from '../components/Toast/index'
import { HotkeyManager } from '../components/HotkeyManager'
import { LeftRail, type LeftTabId } from '../components/LeftRail/index'
import { RightRail, type RightTabId } from '../components/RightRail/index'
import { TextPanel } from '../components/TextPanel/index'
import { CaptionEditor } from '../components/CaptionEditor/index'
import { ComingSoonPanel } from '../components/ComingSoonPanel/index'
import { useExport } from '../store/useExport'
import { useProject, type ProjectState, type ProjectActions } from '../store/useProject'
import { useStartup } from '../store/useStartup'
import { useTimeline } from '../store/useTimeline'
import { useCaption } from '../store/useCaption'
import { useToast } from '../store/useToast'

// ---------------------------------------------------------------------------
// Layout defaults
// ---------------------------------------------------------------------------

const DEFAULT_MEDIA_PANEL_W = 140
const DEFAULT_INSPECTOR_W = 162
const DEFAULT_TIMELINE_H = 142

const MEDIA_PANEL_MIN = 100
const MEDIA_PANEL_MAX = 220
const INSPECTOR_MIN = 140
const INSPECTOR_MAX = 260
const TIMELINE_MIN = 100
const TIMELINE_MAX = 320

type ActiveTool = 'select' | 'blade' | 'hand' | 'zoom'

const TOOLS: Array<{ id: ActiveTool; label: string; hotkey: string; title: string }> = [
  { id: 'select', label: 'V', hotkey: 'V', title: 'Select (V)' },
  { id: 'blade', label: 'B', hotkey: 'B', title: 'Blade / Split (B)' },
  { id: 'hand', label: 'H', hotkey: 'H', title: 'Hand / Pan (H)' },
  { id: 'zoom', label: 'Z', hotkey: 'Z', title: 'Zoom (Z)' }
]

export default function Page(): JSX.Element {
  const [showExport, setShowExport] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [activeLeftTab, setActiveLeftTab] = useState<LeftTabId>('media')
  const [activeRightTab, setActiveRightTab] = useState<RightTabId>('basic')

  // Panel sizes (local state, not project state)
  const [mediaPanelW, setMediaPanelW] = useState(DEFAULT_MEDIA_PANEL_W)
  const [inspectorW, setInspectorW] = useState(DEFAULT_INSPECTOR_W)
  const [timelineH, setTimelineH] = useState(DEFAULT_TIMELINE_H)

  // Resize handler factory
  const makeResizeHandler = (
    direction: 'horizontal-right' | 'horizontal-left' | 'vertical',
    setter: (v: number) => void,
    min: number,
    max: number,
    getInitial: () => number
  ) => (e: React.MouseEvent) => {
    e.preventDefault()
    const startPos = direction === 'vertical' ? e.clientY : e.clientX
    const startVal = getInitial()

    const onMove = (moveEvent: MouseEvent): void => {
      const currentPos = direction === 'vertical' ? moveEvent.clientY : moveEvent.clientX
      const delta =
        direction === 'horizontal-right'
          ? startPos - currentPos // dragging right handle: moving left = bigger inspector
          : direction === 'horizontal-left'
            ? currentPos - startPos // dragging left handle: moving right = bigger media panel
            : currentPos - startPos // vertical: moving down = bigger timeline
      const newVal = Math.min(max, Math.max(min, startVal + delta))
      setter(newVal)
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const { undo, redo } = useProject(
    useShallow((s: ProjectState & ProjectActions) => ({
      undo: s.undo,
      redo: s.redo
    }))
  )

  const { validation, showBanner, setValidation, dismissBanner } = useStartup(
    useShallow((s) => ({
      validation: s.validation,
      showBanner: s.showBanner,
      setValidation: s.setValidation,
      dismissBanner: s.dismissBanner
    }))
  )

  // Listen for startup validation result from main process
  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on('startup:validation', (_event: unknown, data: unknown) => {
      setValidation(data as Parameters<typeof setValidation>[0])
    })
    return () => {
      if (cleanup) cleanup()
    }
  }, [setValidation])

  // Listen for export progress updates
  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on('export:progress', (_event: unknown, data: unknown) => {
      const d = data as { progress?: number; jobId?: string; status?: string }
      if (d.progress !== undefined) {
        useExport.getState().updateProgress(d.jobId!, d.progress)
      }
      if (
        d.status &&
        (d.status === 'completed' || d.status === 'cancelled' || d.status === 'error')
      ) {
        useExport.getState().setJobStatus(d.jobId!, d.status as 'completed' | 'cancelled' | 'error')
        if (d.status === 'completed') useToast.getState().success('Export job completed')
        if (d.status === 'error') useToast.getState().error('Export job failed')
      }
    })
    return () => {
      if (cleanup) cleanup()
    }
  }, [])

  const handleExport = useCallback(() => {
    setShowExport(true)
  }, [])

  const handleToolbarTranscribe = useCallback(async () => {
    const timeline = useTimeline.getState()
    const clips = timeline.clips
    if (clips.length === 0) {
      useToast.getState().warning('Add a video clip to the timeline first.')
      return
    }
    const targetId = timeline.selectedClipId ?? clips[0].id
    try {
      await useCaption.getState().transcribeClip(targetId)
    } catch (e) {
      console.error('Transcription failed:', e)
    }
  }, [])

  const handleAddText = useCallback(() => {
    const { playheadMs, totalDurationMs } = useTimeline.getState()
    const durationMs = Math.min(3000, Math.max(500, totalDurationMs - playheadMs))
    const ts = Date.now()
    const rand = Math.random().toString(36).slice(2, 6)
    const newId = `text_${ts}_${rand}`

    useTimeline.getState().addTextClip({
      id: newId,
      startMs: playheadMs,
      durationMs,
      endMs: playheadMs + durationMs,
      trackIndex: 0,
      text: 'New text',
      style: {
        fontFamily: 'Inter',
        fontSize: 48,
        fontWeight: 700,
        color: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 1,
        bgColor: '#000000',
        bgOpacity: 0.5,
        alignment: 'center',
        position: 'bottom',
        x: 50,
        y: 90,
        rotation: 0,
        scale: 1,
        animation: 'pop'
      }
    })

    // Auto-select the new text clip so Inspector shows it
    useTimeline.getState().selectTextClip(newId)
  }, [])

  const missingItems = validation
    ? [
        !validation.ffmpeg && 'FFmpeg',
        !validation.ffprobe && 'ffprobe',
        !validation.whisperCli && 'Whisper CLI',
        !validation.model && 'AI Model',
        !validation.vcRuntime && 'VC++ Runtime'
      ].filter(Boolean)
    : []

  return (
    <>
      <HotkeyManager
        onExport={handleExport}
        onShortcuts={() => setShowShortcuts(true)}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        onUndo={undo}
        onRedo={redo}
        onAddText={handleAddText}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          width: '100vw',
          background: 'var(--bg0)',
          overflow: 'hidden'
        }}
      >
        {/* TOOLBAR — 38px fixed */}
        <header
          style={{
            height: '38px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            background: 'var(--bg1)',
            borderBottom: '0.5px solid var(--border)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1
              style={{
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--text1)',
                margin: 0
              }}
            >
              CAPCRAFT
            </h1>

            <div className="separator" />

            {/* Tool buttons */}
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                title={tool.title}
                style={{
                  width: '32px',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  color: activeTool === tool.id ? 'var(--accent)' : 'var(--text2)',
                  background: activeTool === tool.id ? 'rgba(79, 127, 255, 0.15)' : 'transparent',
                  border:
                    activeTool === tool.id
                      ? '0.5px solid rgba(79, 127, 255, 0.3)'
                      : '0.5px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onClick={() => setActiveTool(tool.id)}
              >
                {tool.label}
              </button>
            ))}

            <div className="separator" />

            <span style={{ fontSize: '10px', color: 'var(--text3)' }}>
              {activeTool === 'select' && 'Select & Move'}
              {activeTool === 'blade' && 'Click to split'}
              {activeTool === 'hand' && 'Click & drag to pan'}
              {activeTool === 'zoom' && 'Click to zoom'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="toolbar-btn" onClick={undo} title="Undo (Ctrl+Z)">
              ↩
            </button>
            <button className="toolbar-btn" onClick={redo} title="Redo (Ctrl+Shift+Z)">
              ↪
            </button>

            <div className="separator" />

            <button
              onClick={handleToolbarTranscribe}
              title="Auto-generate captions with Whisper"
              style={{
                padding: '4px 10px',
                background: 'var(--bg3)',
                border: '0.5px solid var(--border2)',
                borderRadius: '5px',
                color: 'var(--text2)',
                fontSize: '11px',
                cursor: 'pointer',
                marginRight: '2px'
              }}
            >
              CC ✦
            </button>

            <button
              onClick={handleAddText}
              title="Add text overlay (T)"
              style={{
                padding: '4px 10px',
                background: 'var(--bg3)',
                border: '0.5px solid var(--border2)',
                borderRadius: '5px',
                color: 'var(--text2)',
                fontSize: '11px',
                cursor: 'pointer',
                fontWeight: 700,
                marginRight: '2px'
              }}
            >
              T
            </button>

            <button
              className="btn btn-primary"
              onClick={() => setShowExport(true)}
              title="Export (Ctrl+E)"
            >
              Export ↗
            </button>
          </div>
        </header>

        {/* Startup validation banner */}
        {showBanner && (missingItems.length > 0 || validation?.modelWarning) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 16px',
              background: 'rgba(245, 158, 11, 0.1)',
              borderBottom: '0.5px solid rgba(245, 158, 11, 0.3)',
              fontSize: '11px',
              color: 'var(--amber)',
              flexShrink: 0
            }}
          >
            <span>
              {validation?.modelWarning
                ? validation.modelWarning
                : `Missing dependencies: ${missingItems.join(', ')}. Some features may not work.`}
            </span>
            <button
              style={{
                fontSize: '11px',
                color: 'var(--amber)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                marginLeft: '16px'
              }}
              onClick={dismissBanner}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main content area — 4 columns: LeftRail + ContentPanel + Preview + Inspector */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left Icon Rail — fixed 64px */}
          <LeftRail activeTab={activeLeftTab} onSelect={setActiveLeftTab} />

          {/* Left content panel — switched by active left tab */}
          <div
            style={{
              width: `${mediaPanelW}px`,
              flexShrink: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {activeLeftTab === 'media' && <MediaPanel />}
            {activeLeftTab === 'text' && <TextPanel />}
            {activeLeftTab === 'captions' && <CaptionEditor />}
            {activeLeftTab === 'templates' && <ComingSoonPanel label="Templates" />}
            {activeLeftTab === 'elements' && <ComingSoonPanel label="Elements" />}
            {activeLeftTab === 'audio' && <ComingSoonPanel label="Audio" />}
            {activeLeftTab === 'transcript' && <ComingSoonPanel label="Transcript" />}
            {activeLeftTab === 'effects' && <ComingSoonPanel label="Effects" />}
            {activeLeftTab === 'transitions' && <ComingSoonPanel label="Transitions" />}
            {activeLeftTab === 'filters' && <ComingSoonPanel label="Filters" />}
            {activeLeftTab === 'plugins' && <ComingSoonPanel label="Plugins" />}
          </div>

          {/* Resize handle: Media panel (right edge) */}
          <div
            style={{ width: '4px', cursor: 'col-resize', flexShrink: 0, background: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onMouseDown={makeResizeHandler(
              'horizontal-left', setMediaPanelW, MEDIA_PANEL_MIN, MEDIA_PANEL_MAX,
              () => mediaPanelW
            )}
          />

          {/* Center column: Preview */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg0)',
                padding: '16px',
                minHeight: 0
              }}
            >
              <Preview />
            </div>
            <CaptionStrip />
            <PlaybackControls />
          </div>

          {/* Resize handle: Inspector (left edge) */}
          <div
            style={{ width: '4px', cursor: 'col-resize', flexShrink: 0, background: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onMouseDown={makeResizeHandler(
              'horizontal-right', setInspectorW, INSPECTOR_MIN, INSPECTOR_MAX,
              () => inspectorW
            )}
          />

          {/* Right column: Inspector + RightRail */}
          <div
            style={{
              width: `${inspectorW}px`,
              flexShrink: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <Inspector rightTab={activeRightTab} />
          </div>

          {/* Right Icon Rail — fixed 64px */}
          <RightRail activeTab={activeRightTab} onSelect={setActiveRightTab} />
        </div>

        {/* Resize handle: Timeline (top edge) */}
        <div
          style={{ height: '4px', cursor: 'row-resize', flexShrink: 0, background: 'transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          onMouseDown={makeResizeHandler(
            'vertical', setTimelineH, TIMELINE_MIN, TIMELINE_MAX,
            () => timelineH
          )}
        />

        {/* Bottom: Timeline */}
        <div
          style={{
            height: `${timelineH}px`,
            flexShrink: 0,
            overflow: 'hidden'
          }}
        >
          <Timeline activeTool={activeTool} />
        </div>
      </div>

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      <ConfirmDialog />
      <ToastContainer />
    </>
  )
}
