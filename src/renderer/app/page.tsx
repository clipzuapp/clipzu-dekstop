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
import { RelinkDialog } from '../components/RelinkDialog/index'
import { ShortcutsDialog } from '../components/ShortcutsDialog/index'
import { ToastContainer } from '../components/Toast/index'
import { HotkeyManager } from '../components/HotkeyManager'
import { LeftRail, type LeftTabId } from '../components/LeftRail/index'
import { RightRail, type RightTabId } from '../components/RightRail/index'
import { TextPanel } from '../components/TextPanel/index'
import { TranscriptPanel } from '../components/TranscriptPanel/index'
import { AudioPanel } from '../components/AudioPanel/index'
import { ComingSoonPanel } from '../components/ComingSoonPanel/index'
import { EffectsPanel } from '../components/EffectsPanel/index'
import { FiltersPanel } from '../components/FiltersPanel/index'
import { ErrorBoundary } from '../components/ErrorBoundary/index'
import { preloadSounds } from '../services/NotificationSound'
import { Undo2, Redo2, Scissors, Hand, ZoomIn, MousePointer2 } from 'lucide-react'
import { useExport } from '../store/useExport'
import { useTimeline, createTextClip, performUndo, performRedo } from '../store/useTimeline'
import { useStartup } from '../store/useStartup'
import { useCaption, defaultStyle } from '../store/useCaption'
import { laneForManualText } from '../../shared/captions/lanes'
import { useUiPrefs } from '../store/useUiPrefs'
import { useProject } from '../store/useProject'
import {
  loadUiPrefs,
  defaultStorage,
  resolveStartupZoom,
  NARROW_WINDOW_PX,
} from '../../shared/uiPrefs'
import { useToast } from '../store/useToast'
import { usePreviewView } from '../store/usePreviewView'
import {
  MODEL_CANCEL_CHANNEL,
  MODEL_DOWNLOAD_CHANNEL,
  MODEL_GET_STATUS_CHANNEL,
  MODEL_PROGRESS_CHANNEL,
  MEDIA_RUNTIME_CANCEL_CHANNEL,
  MEDIA_RUNTIME_DOWNLOAD_CHANNEL,
  MEDIA_RUNTIME_GET_STATUS_CHANNEL,
  MEDIA_RUNTIME_INSTALL_LOCAL_CHANNEL,
  MEDIA_RUNTIME_PROGRESS_CHANNEL,
} from '../../shared/ipc/channels'
import type { ModelDeliveryResult, ModelDeliveryStatus } from '../../shared/modelCatalog'

function isModelDeliveryStatus(value: unknown): value is ModelDeliveryStatus {
  if (typeof value !== 'object' || value === null) return false
  const status = value as Partial<ModelDeliveryStatus>
  return ['missing', 'downloading', 'verifying', 'ready', 'error'].includes(String(status.phase)) &&
    typeof status.receivedBytes === 'number' && typeof status.totalBytes === 'number'
}

function isModelDeliveryResult(value: unknown): value is ModelDeliveryResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Partial<ModelDeliveryResult>
  return typeof result.ok === 'boolean' && isModelDeliveryStatus(result.status)
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const MEDIA_PANEL_MIN = 160
const MEDIA_PANEL_MAX_PCT = 0.30
const INSPECTOR_MIN = 200
const INSPECTOR_MAX_PCT = 0.32
const TIMELINE_MIN = 100
const TIMELINE_MAX_PCT = 0.45

// Default panel sizes — percentage of window at mount time
function defaultMediaPanelW(): number { return Math.round(window.innerWidth * 0.18) }
function defaultInspectorW(): number  { return Math.round(window.innerWidth * 0.20) }
function defaultTimelineH(): number   { return Math.round(window.innerHeight * 0.25) }

// Clamp a panel size against current window dimensions
function clampMediaPanelW(v: number): number {
  return Math.min(Math.round(window.innerWidth * MEDIA_PANEL_MAX_PCT), Math.max(MEDIA_PANEL_MIN, v))
}
function clampInspectorW(v: number): number {
  return Math.min(Math.round(window.innerWidth * INSPECTOR_MAX_PCT), Math.max(INSPECTOR_MIN, v))
}
function clampTimelineH(v: number): number {
  return Math.min(Math.round(window.innerHeight * TIMELINE_MAX_PCT), Math.max(TIMELINE_MIN, v))
}

type ActiveTool = 'select' | 'blade' | 'hand' | 'zoom'

const TOOLS: Array<{ id: ActiveTool; label: string; icon: JSX.Element; hotkey: string; title: string }> = [
  { id: 'select', label: 'V', icon: <MousePointer2 size={14} />, hotkey: 'V', title: 'Select (V)' },
  { id: 'blade', label: 'B', icon: <Scissors size={14} />, hotkey: 'B', title: 'Blade / Split (B)' },
  { id: 'hand', label: 'H', icon: <Hand size={14} />, hotkey: 'H', title: 'Hand / Pan (H)' },
  { id: 'zoom', label: 'Z', icon: <ZoomIn size={14} />, hotkey: 'Z', title: 'Zoom (Z)' }
]

export default function Page(): JSX.Element {
  const [showExport, setShowExport] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [activeLeftTab, setActiveLeftTab] = useState<LeftTabId>('media')
  const [activeRightTab, setActiveRightTab] = useState<RightTabId>('basic')
  const [modelStatus, setModelStatus] = useState<ModelDeliveryStatus | null>(null)
  const [mediaRuntimeStatus, setMediaRuntimeStatus] = useState<ModelDeliveryStatus | null>(null)
  const isFullscreen = usePreviewView((s) => s.isFullscreen)
  const toggleFullscreen = usePreviewView((s) => s.toggleFullscreen)

  // Panel sizes — restored from app prefs when present, else window-derived
  // defaults (P3.1/interface_blueprint: panel persistence, machine-local).
  const [mediaPanelW, setMediaPanelW] = useState(
    () => clampMediaPanelW(loadUiPrefs(defaultStorage()).mediaPanelW ?? defaultMediaPanelW()))
  const [inspectorW, setInspectorW] = useState(
    () => clampInspectorW(loadUiPrefs(defaultStorage()).inspectorW ?? defaultInspectorW()))
  const [timelineH, setTimelineH] = useState(
    () => clampTimelineH(loadUiPrefs(defaultStorage()).timelineH ?? defaultTimelineH()))

  // Startup (P3.1/D1): hydrate session prefs (narrow-window default applies
  // on first run), then apply the remembered/smart zoom when no project is
  // open. A loaded `.clipzu` zoom always wins later via loadTimeline.
  useEffect(() => {
    const narrowWindow = window.innerWidth < NARROW_WINDOW_PX
    useUiPrefs.getState().hydrate(narrowWindow)
    if (useProject.getState().projectFilePath === null) {
      const saved = useUiPrefs.getState().timelineZoom
      useTimeline.getState().setZoom(resolveStartupZoom(saved, window.innerWidth))
    }
  }, [])

  // Pre-load notification sound paths for instant playback
  useEffect(() => { preloadSounds() }, [])

  // Clamp panel sizes whenever the window is resized so they never exceed their
  // percentage caps (which would crush the center preview area to zero).
  useEffect(() => {
    const onResize = (): void => {
      setMediaPanelW((w) => clampMediaPanelW(w))
      setInspectorW((w) => clampInspectorW(w))
      setTimelineH((h) => clampTimelineH(h))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ---------------------------------------------------------------------------
  // Resize handle factory — max is read from window at drag-start, not at render
  // ---------------------------------------------------------------------------
  const makeResizeHandler = useCallback((
    direction: 'horizontal-right' | 'horizontal-left' | 'vertical',
    setter: React.Dispatch<React.SetStateAction<number>>,
    min: number,
    maxPct: number,
    getInitial: () => number,
    /** Persisted on drag-end (P3.1 panel-size memory). Receives the final px. */
    onCommit?: (value: number) => void
  ) => (e: React.MouseEvent): void => {
    e.preventDefault()
    const startPos = direction === 'vertical' ? e.clientY : e.clientX
    const startVal = getInitial()
    // Capture max at drag-start time so it reflects the current window size
    const max = direction === 'vertical'
      ? Math.round(window.innerHeight * maxPct)
      : Math.round(window.innerWidth * maxPct)

    let last = startVal
    const onMove = (moveEvent: MouseEvent): void => {
      const currentPos = direction === 'vertical' ? moveEvent.clientY : moveEvent.clientX
      const delta =
        direction === 'horizontal-right'
          ? startPos - currentPos
          : direction === 'horizontal-left'
            ? currentPos - startPos
            : startPos - currentPos
      last = Math.min(max, Math.max(min, startVal + delta))
      setter(last)
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      onCommit?.(last)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Toolbar undo/redo go through the same centralized operations as the
  // hotkeys (capture + pop + apply). Calling the raw store actions here used
  // to pop history WITHOUT applying it — silently eating undo entries.
  const handleToolbarUndo = useCallback(() => { performUndo() }, [])
  const handleToolbarRedo = useCallback(() => { performRedo() }, [])

  const { validation, showBanner, setValidation, dismissBanner } = useStartup(
    useShallow((s) => ({
      validation: s.validation,
      showBanner: s.showBanner,
      setValidation: s.setValidation,
      dismissBanner: s.dismissBanner
    }))
  )

  useEffect(() => {
    let mounted = true
    void window.electron.ipcRenderer.invoke(MODEL_GET_STATUS_CHANNEL).then((value: unknown) => {
      if (mounted && isModelDeliveryStatus(value)) setModelStatus(value)
    }).catch(() => {
      if (mounted) setModelStatus({ phase: 'missing', receivedBytes: 0, totalBytes: 0, percent: 0 })
    })
    const cleanup = window.electron.ipcRenderer.on(MODEL_PROGRESS_CHANNEL, (_event: unknown, value: unknown) => {
      if (isModelDeliveryStatus(value)) {
        setModelStatus(value)
        if (value.phase === 'ready' && validation) {
          setValidation({ ...validation, model: true, modelWarning: undefined })
        }
      }
    })
    return () => {
      mounted = false
      cleanup()
    }
  }, [validation, setValidation])

  useEffect(() => {
    let mounted = true
    void window.electron.ipcRenderer.invoke(MEDIA_RUNTIME_GET_STATUS_CHANNEL).then((value: unknown) => {
      if (mounted && isModelDeliveryStatus(value)) setMediaRuntimeStatus(value)
    }).catch(() => {
      if (mounted) setMediaRuntimeStatus({ phase: 'missing', receivedBytes: 0, totalBytes: 0, percent: 0 })
    })
    const cleanup = window.electron.ipcRenderer.on(MEDIA_RUNTIME_PROGRESS_CHANNEL, (_event: unknown, value: unknown) => {
      if (isModelDeliveryStatus(value)) {
        setMediaRuntimeStatus(value)
        if (value.phase === 'ready' && validation) setValidation({ ...validation, ffmpeg: true, ffprobe: true })
      }
    })
    return () => {
      mounted = false
      cleanup()
    }
  }, [validation, setValidation])

  const handleModelDownload = useCallback(async () => {
    setModelStatus({ phase: 'downloading', receivedBytes: 0, totalBytes: 0, percent: 0 })
    try {
      const value: unknown = await window.electron.ipcRenderer.invoke(MODEL_DOWNLOAD_CHANNEL)
      if (!isModelDeliveryResult(value)) throw new Error('Model download returned an invalid response.')
      setModelStatus(value.status)
      if (value.ok) {
        if (validation) setValidation({ ...validation, model: true, modelWarning: undefined })
        useToast.getState().success('Transcription model installed and ready.')
      } else if (value.status.phase === 'error') {
        useToast.getState().error(value.status.error ?? 'Model download failed. Try again.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Model download failed. Try again.'
      setModelStatus({ phase: 'error', receivedBytes: 0, totalBytes: 0, percent: null, error: message })
      useToast.getState().error(message)
    }
  }, [validation, setValidation])

  const handleModelCancel = useCallback(() => {
    void window.electron.ipcRenderer.invoke(MODEL_CANCEL_CHANNEL)
  }, [])

  const handleMediaRuntimeInstall = useCallback(async (channel: typeof MEDIA_RUNTIME_DOWNLOAD_CHANNEL | typeof MEDIA_RUNTIME_INSTALL_LOCAL_CHANNEL) => {
    setMediaRuntimeStatus({ phase: 'downloading', receivedBytes: 0, totalBytes: 0, percent: null })
    try {
      const value: unknown = await window.electron.ipcRenderer.invoke(channel)
      if (!isModelDeliveryResult(value)) throw new Error('FFmpeg installation returned an invalid response.')
      setMediaRuntimeStatus(value.status)
      if (value.ok) {
        if (validation) setValidation({ ...validation, ffmpeg: true, ffprobe: true })
        useToast.getState().success('FFmpeg is installed. Editing and export now work offline.')
      } else if (value.status.phase === 'error') {
        useToast.getState().error(value.status.error ?? 'FFmpeg installation failed. Try again.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'FFmpeg installation failed. Try again.'
      setMediaRuntimeStatus({ phase: 'error', receivedBytes: 0, totalBytes: 0, percent: null, error: message })
      useToast.getState().error(message)
    }
  }, [validation, setValidation])

  const handleMediaRuntimeCancel = useCallback(() => {
    void window.electron.ipcRenderer.invoke(MEDIA_RUNTIME_CANCEL_CHANNEL)
  }, [])

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
      const d = data as { progress?: number; jobId?: string; status?: string; error?: string }
      if (d.progress !== undefined) {
        useExport.getState().updateProgress(d.jobId!, d.progress)
      }
      if (
        d.status &&
        (d.status === 'completed' || d.status === 'cancelled' || d.status === 'error')
      ) {
        useExport.getState().setJobStatus(d.jobId!, d.status as 'completed' | 'cancelled' | 'error', d.error)
        if (d.status === 'completed') useToast.getState().success('Export job completed')
        if (d.status === 'error') {
          const detail = `Export job: ${d.jobId ?? 'unknown'}\nStatus: ${d.status}\nError: ${d.error ?? 'No failure details supplied.'}`
          useToast.getState().error(d.error ? `Export failed: ${d.error}` : 'Export job failed', detail)
        }
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
    const targetId = timeline.focusedId ?? clips[0]?.id
    try {
      await useCaption.getState().transcribeClip(targetId)
    } catch (e) {
      console.error('Transcription failed:', e)
      useToast.getState().error(`Transcription failed: ${(e as Error).message}`)
    }
  }, [])

  const handleAddText = useCallback(() => {
    const st = useTimeline.getState()
    const { playheadMs, totalDurationMs } = st
    const durationMs = Math.min(3000, Math.max(500, totalDurationMs - playheadMs))

    const clip = createTextClip({
      text: 'New text',
      startMs: playheadMs,
      durationMs,
      endMs: playheadMs + durationMs,
      // P2.1: same first-free routing as TextPanel — never silently lane 0.
      trackIndex: laneForManualText(st.textClips),
      style: { ...defaultStyle },
    })

    useTimeline.getState().addTextClip(clip)
    useTimeline.getState().selectTextClip(clip.id)
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
        onAddText={handleAddText}
        activeLeftTab={activeLeftTab}
      />

      <div className="layout-shell">
        {/* TOOLBAR — 38px fixed */}
        <header className="layout-toolbar">
          <div className="toolbar-group">
            <h1 className="toolbar-brand">CLIPZU</h1>

            <div className="separator" />

            {/* Tool buttons */}
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                title={tool.title}
                className={`tool-btn${activeTool === tool.id ? ' tool-btn-active' : ''}`}
                onClick={() => setActiveTool(tool.id)}
              >
                {tool.label}
                {tool.icon}
              </button>
            ))}

            <div className="separator" />

            <span className="tool-hint">
              {activeTool === 'select' && 'Select & Move'}
              {activeTool === 'blade' && 'Click to split'}
              {activeTool === 'hand' && 'Click & drag to pan'}
              {activeTool === 'zoom' && 'Click to zoom'}
            </span>
          </div>

          <div className="toolbar-group toolbar-group-right">
            <button className="toolbar-btn" onClick={handleToolbarUndo} title="Undo (Ctrl+Z)">
              <Undo2 size={14} />
            </button>
            <button className="toolbar-btn" onClick={handleToolbarRedo} title="Redo (Ctrl+Shift+Z)">
              <Redo2 size={14} />
            </button>

            <div className="separator" />

            <button
              onClick={handleToolbarTranscribe}
              title="Auto-generate captions with Whisper"
              className="toolbar-action-btn"
            >
              CC ✦
            </button>

            <button
              onClick={handleAddText}
              title="Add text overlay (T)"
              className="toolbar-action-btn"
              style={{ fontWeight: 700 }}
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
            className="validation-banner"
          >
            <span>
              {validation?.modelWarning ??
                `Missing dependencies: ${missingItems.join(', ')}. ${!validation?.ffmpeg ? 'Offline media runtime missing: install FFmpeg once to enable media import, preview, and export. It stays available offline afterward.' : 'Some features may not work.'}`}
              {mediaRuntimeStatus?.phase === 'ready' && validation?.ffmpeg && ' Media runtime ready; editing and export work offline.'}
              {mediaRuntimeStatus?.phase === 'downloading' && ` Media runtime installing: ${mediaRuntimeStatus.percent === null ? `${Math.round(mediaRuntimeStatus.receivedBytes / 1_048_576)} MB` : `${Math.round(mediaRuntimeStatus.percent)}%`}.`}
              {mediaRuntimeStatus?.phase === 'verifying' && ' Checking and installing the media runtime…'}
              {mediaRuntimeStatus?.phase === 'error' && ` ${mediaRuntimeStatus.error ?? 'FFmpeg installation failed.'}`}
              {modelStatus?.phase === 'downloading' && ` Downloading model: ${modelStatus.percent === null ? `${Math.round(modelStatus.receivedBytes / 1_048_576)} MB` : `${Math.round(modelStatus.percent)}%`}.`}
              {modelStatus?.phase === 'verifying' && ' Verifying downloaded model…'}
              {modelStatus?.phase === 'error' && ` ${modelStatus.error ?? 'Model download failed.'}`}
            </span>
            {!validation?.ffmpeg && mediaRuntimeStatus?.phase !== 'downloading' && mediaRuntimeStatus?.phase !== 'verifying' && (
              <>
                <button className="btn btn-primary" onClick={() => void handleMediaRuntimeInstall(MEDIA_RUNTIME_DOWNLOAD_CHANNEL)}>
                  {mediaRuntimeStatus?.phase === 'error' ? 'Retry FFmpeg download' : 'Download FFmpeg (~104 MB)'}
                </button>
                <button className="btn btn-secondary" onClick={() => void handleMediaRuntimeInstall(MEDIA_RUNTIME_INSTALL_LOCAL_CHANNEL)}>
                  Install from local archive
                </button>
              </>
            )}
            {!validation?.model && modelStatus?.phase !== 'downloading' && modelStatus?.phase !== 'verifying' && (
              <button className="btn btn-primary" onClick={() => void handleModelDownload()}>
                {modelStatus?.phase === 'error' ? 'Retry model download' : 'Download transcription model'}
              </button>
            )}
            {(mediaRuntimeStatus?.phase === 'downloading' || mediaRuntimeStatus?.phase === 'verifying') && (
              <button className="btn btn-secondary" onClick={handleMediaRuntimeCancel}>Cancel FFmpeg install</button>
            )}
            {(modelStatus?.phase === 'downloading' || modelStatus?.phase === 'verifying') && (
              <button className="btn btn-secondary" onClick={handleModelCancel}>Cancel</button>
            )}
            <button
              className="validation-banner-dismiss"
              onClick={dismissBanner}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main content area — 4 columns: LeftRail + ContentPanel + Preview + Inspector */}
        <div className="layout-main-row">
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
            {activeLeftTab === 'transcript' && <TranscriptPanel />}
            {activeLeftTab === 'templates' && <ComingSoonPanel label="Templates" />}
            {activeLeftTab === 'elements' && <ComingSoonPanel label="Elements" />}
            {activeLeftTab === 'audio' && <AudioPanel />}
            {activeLeftTab === 'effects' && <EffectsPanel />}
            {activeLeftTab === 'transitions' && <ComingSoonPanel label="Transitions" />}
            {activeLeftTab === 'filters' && <FiltersPanel />}
            {activeLeftTab === 'plugins' && <ComingSoonPanel label="Plugins" />}
          </div>

          {/* Resize handle: Media panel (right edge) */}
          <div
            className="resize-handle resize-handle-vertical"
            onMouseDown={makeResizeHandler(
              'horizontal-left', setMediaPanelW, MEDIA_PANEL_MIN, MEDIA_PANEL_MAX_PCT,
              () => mediaPanelW,
              (v) => useUiPrefs.getState().setPanelSize('mediaPanelW', v)
            )}
          />

          {/* Center column — Preview renders here when not fullscreen.
              In fullscreen mode the Preview instance moves to the fixed overlay
              (conditional render) so exactly one <video>/<canvas> is ever mounted. */}
          <div
            className="layout-preview-col"
          >
            <div className="layout-preview-area">
              {!isFullscreen && <ErrorBoundary label="Preview"><Preview /></ErrorBoundary>}
            </div>
            <div style={{ flexShrink: 0 }}>
              <CaptionStrip />
              <PlaybackControls />
            </div>
          </div>

          {/* Resize handle: Inspector (left edge) */}
          <div
            className="resize-handle resize-handle-vertical"
            onMouseDown={makeResizeHandler(
              'horizontal-right', setInspectorW, INSPECTOR_MIN, INSPECTOR_MAX_PCT,
              () => inspectorW,
              (v) => useUiPrefs.getState().setPanelSize('inspectorW', v)
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
          className="resize-handle resize-handle-horizontal"
          onMouseDown={makeResizeHandler(
            'vertical', setTimelineH, TIMELINE_MIN, TIMELINE_MAX_PCT,
            () => timelineH,
            (v) => useUiPrefs.getState().setPanelSize('timelineH', v)
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
          <ErrorBoundary label="Timeline"><Timeline activeTool={activeTool} /></ErrorBoundary>
        </div>
      </div>

      {/* ExportDialog — rendered outside the main layout div so it overlays as
          position:fixed without being clipped by any stacking context */}
      <ExportDialog show={showExport} onClose={() => setShowExport(false)} />

      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      <ConfirmDialog />
      <RelinkDialog />
      <ToastContainer />

      {/* Fullscreen preview overlay — only renders the single Preview instance
          when fullscreen is active. When not fullscreen, Preview renders in-layout
          above. This guarantees exactly one <video> element is ever mounted. */}
      {isFullscreen && (
        <div
          className="fullscreen-overlay"
        >
          <div className="fullscreen-preview-area">
            <ErrorBoundary label="Preview"><Preview /></ErrorBoundary>
          </div>
          <CaptionStrip />
          <PlaybackControls />
          <button
            onClick={toggleFullscreen}
            className="fullscreen-exit-btn"
          >
            Exit (Esc)
          </button>
        </div>
      )}
    </>
  )
}
