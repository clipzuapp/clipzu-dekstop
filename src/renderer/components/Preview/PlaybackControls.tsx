import { useState, useRef, useEffect } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { useProject, type AspectRatio, RESOLUTION_PRESETS } from '../../store/useProject'
import { usePreviewView, ZOOM_PRESETS, SPEED_PRESETS, type QualityMode } from '../../store/usePreviewView'
import { formatTimecode } from '../../utils/format'
import { linearToDb, dbToLinear } from '../../utils/audio'
import {
  SkipBack, Rewind, Play, Pause, FastForward, SkipForward,
  Volume2, VolumeX, Repeat, Maximize2, Minimize2, Grid3x3,
  Square, Eye, EyeOff
} from 'lucide-react'
import { SliderInputField } from '../SliderInputField/index'

// ---------------------------------------------------------------------------
// Dropdown primitive — lightweight, dark-themed, no external deps
// ---------------------------------------------------------------------------

interface DropdownItem {
  label: string
  value: string
  active?: boolean
}

function Dropdown({ items, onSelect, onClose }: {
  items: DropdownItem[]
  onSelect: (value: string) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        marginBottom: 4,
        background: 'var(--bg2)',
        border: '0.5px solid var(--border)',
        borderRadius: 4,
        padding: '2px 0',
        zIndex: 100,
        minWidth: 90,
        boxShadow: '0 -4px 16px rgba(0,0,0,0.4)'
      }}
    >
      {items.map((item) => (
        <div
          key={item.value}
          onClick={() => { onSelect(item.value); onClose() }}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            color: item.active ? 'var(--accent)' : 'var(--text2)',
            background: item.active ? 'rgba(79,127,255,0.1)' : 'transparent',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
          onMouseEnter={(e) => { (e.target as HTMLDivElement).style.background = 'var(--bg3)' }}
          onMouseLeave={(e) => { (e.target as HTMLDivElement).style.background = item.active ? 'rgba(79,127,255,0.1)' : 'transparent' }}
        >
          {item.label}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PlaybackControls
// ---------------------------------------------------------------------------

export function PlaybackControls(): JSX.Element {
  const isPlaying = useTimeline((s) => s.isPlaying)
  const playheadMs = useTimeline((s) => s.playheadMs)
  const totalDurationMs = useTimeline((s) => s.totalDurationMs)
  const setPlaying = useTimeline((s) => s.setPlaying)
  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const masterVolume = useTimeline((s) => s.masterVolume)
  const setMasterVolume = useTimeline((s) => s.setMasterVolume)
  const loopEnabled = useTimeline((s) => s.loopEnabled)
  const toggleLoop = useTimeline((s) => s.toggleLoop)

  const aspectRatio = useProject((s) => s.aspectRatio)
  const setAspectRatio = useProject((s) => s.setAspectRatio)
  const fps = useProject((s) => s.fps)

  const zoomMode = usePreviewView((s) => s.zoomMode)
  const setZoomMode = usePreviewView((s) => s.setZoomMode)
  const quality = usePreviewView((s) => s.quality)
  const setQuality = usePreviewView((s) => s.setQuality)
  const playbackSpeed = usePreviewView((s) => s.playbackSpeed)
  const setPlaybackSpeed = usePreviewView((s) => s.setPlaybackSpeed)
  const isFullscreen = usePreviewView((s) => s.isFullscreen)
  const toggleFullscreen = usePreviewView((s) => s.toggleFullscreen)
  const guides = usePreviewView((s) => s.guides)
  const toggleGuide = usePreviewView((s) => s.toggleGuide)
  const cycleGrid = usePreviewView((s) => s.cycleGrid)

  // Dropdown state: which dropdown is open
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)

  const handlePlayPause = (): void => { setPlaying(!isPlaying) }
  const handleRewind = (): void => { setPlayhead(Math.max(0, playheadMs - 5000)) }
  const handleForward = (): void => { setPlayhead(Math.min(totalDurationMs, playheadMs + 5000)) }
  const handleJumpStart = (): void => { if (isPlaying) setPlaying(false); setPlayhead(0) }
  const handleJumpEnd = (): void => { setPlayhead(totalDurationMs) }

  // Zoom display label
  const zoomLabel = typeof zoomMode === 'number' ? `${zoomMode}%` : zoomMode === 'fit' ? 'Fit' : 'Fill'

  // Aspect ratio options (exclude 'custom')
  const arOptions: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5', '4:3']

  return (
    <div
      style={{
        height: 40,
        background: 'var(--bg1)',
        borderTop: '0.5px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        gap: 8,
        flexShrink: 0,
        overflow: 'hidden',
        minWidth: 0
      }}
    >
      {/* Left group: playback buttons — never shrink */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <button className="toolbar-btn" onClick={handleJumpStart} title="Jump to start" style={{ padding: '5px 8px' }}>
          <SkipBack size={14} />
        </button>
        <button className="toolbar-btn" onClick={handleRewind} title="Rewind 5s (J)" style={{ padding: '5px 8px' }}>
          <Rewind size={14} />
        </button>
        <button
          className="toolbar-btn"
          onClick={handlePlayPause}
          title="Play/Pause (Space)"
          style={{ padding: '5px 10px', background: 'var(--bg3)', fontWeight: 500 }}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="toolbar-btn" onClick={handleForward} title="Forward 5s (L)" style={{ padding: '5px 8px' }}>
          <FastForward size={14} />
        </button>
        <button className="toolbar-btn" onClick={handleJumpEnd} title="Jump to end" style={{ padding: '5px 8px' }}>
          <SkipForward size={14} />
        </button>

        {/* Loop toggle */}
        <button
          className="toolbar-btn"
          onClick={toggleLoop}
          title="Toggle loop (Shift+L)"
          style={{
            padding: '5px 8px',
            color: loopEnabled ? 'var(--accent)' : undefined,
            background: loopEnabled ? 'rgba(79,127,255,0.15)' : undefined
          }}
        >
          <Repeat size={14} />
        </button>
      </div>

      {/* Timecode — fixed-width container prevents layout shift */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginLeft: 8,
          padding: '2px 8px',
          background: 'var(--bg2)',
          borderRadius: 4,
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap',
          flexShrink: 0
        }}
      >
        <span style={{ color: 'var(--text1)', minWidth: 100, textAlign: 'right' }}>
          {formatTimecode(playheadMs, fps)}
        </span>
        <span style={{ color: 'var(--text3)', fontSize: 10 }}>/</span>
        <span style={{ color: 'var(--text3)', minWidth: 100 }}>
          {formatTimecode(totalDurationMs, fps)}
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1, minWidth: 8 }} />

      {/* Right-side controls — shrink as a unit when bar is narrow */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>

      {/* Guide toggles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <button
          className="toolbar-btn"
          onClick={() => toggleGuide('titleSafe')}
          title="Title Safe (5% inset)"
          style={{
            padding: '4px 6px',
            color: guides.titleSafe ? 'var(--accent)' : undefined,
            background: guides.titleSafe ? 'rgba(79,127,255,0.15)' : undefined
          }}
        >
          <Square size={12} />
        </button>
        <button
          className="toolbar-btn"
          onClick={() => toggleGuide('actionSafe')}
          title="Action Safe (3.5% inset)"
          style={{
            padding: '4px 6px',
            color: guides.actionSafe ? 'rgba(255,200,50,0.8)' : undefined,
            background: guides.actionSafe ? 'rgba(255,200,50,0.1)' : undefined
          }}
        >
          {guides.actionSafe ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button
          className="toolbar-btn"
          onClick={cycleGrid}
          title="Cycle grid (Shift+G): None → Thirds → Center"
          style={{
            padding: '4px 6px',
            color: guides.grid !== 'none' ? 'var(--accent)' : undefined,
            background: guides.grid !== 'none' ? 'rgba(79,127,255,0.15)' : undefined
          }}
        >
          <Grid3x3 size={12} />
        </button>
      </div>

      <div className="separator" />

      {/* Volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--text2)' }}>
          {masterVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </span>
        <SliderInputField label="Volume" value={linearToDb(masterVolume)} min={-30} max={0} step={0.5} unit="dB"
          compact
          onChange={(v) => setMasterVolume(dbToLinear(v))} />
      </div>

      <div className="separator" />

      {/* Playback speed dropdown */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button
          className="toolbar-btn"
          onClick={() => setOpenDropdown(openDropdown === 'speed' ? null : 'speed')}
          title="Playback speed"
          style={{ fontSize: 11, padding: '3px 6px', fontFamily: 'monospace' }}
        >
          {playbackSpeed}x
        </button>
        {openDropdown === 'speed' && (
          <Dropdown
            items={SPEED_PRESETS.map((s) => ({
              label: `${s}x`, value: String(s), active: playbackSpeed === s
            }))}
            onSelect={(v) => setPlaybackSpeed(parseFloat(v))}
            onClose={() => setOpenDropdown(null)}
          />
        )}
      </div>

      <div className="separator" />

      {/* Aspect ratio dropdown */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button
          className="toolbar-btn"
          onClick={() => setOpenDropdown(openDropdown === 'aspect' ? null : 'aspect')}
          title="Aspect ratio"
          style={{ fontSize: 12, padding: '3px 8px' }}
        >
          {aspectRatio} <span style={{ fontSize: 10, color: 'var(--text3)' }}>▾</span>
        </button>
        {openDropdown === 'aspect' && (
          <Dropdown
            items={arOptions.map((ar) => {
              const [w, h] = RESOLUTION_PRESETS[ar]
              return { label: `${ar} (${w}×${h})`, value: ar, active: aspectRatio === ar }
            })}
            onSelect={(v) => setAspectRatio(v as AspectRatio)}
            onClose={() => setOpenDropdown(null)}
          />
        )}
      </div>

      <div className="separator" />

      {/* Quality dropdown */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button
          className="toolbar-btn"
          onClick={() => setOpenDropdown(openDropdown === 'quality' ? null : 'quality')}
          title="Preview quality"
          style={{ fontSize: 11, padding: '3px 6px' }}
        >
          {quality === 'full' ? 'Full' : quality === 'half' ? '½' : '¼'}
        </button>
        {openDropdown === 'quality' && (
          <Dropdown
            items={([
              { label: 'Full (1x)', value: 'full' },
              { label: 'Half (½x)', value: 'half' },
              { label: 'Quarter (¼x)', value: 'quarter' }
            ] as const).map((q) => ({ ...q, active: quality === q.value }))}
            onSelect={(v) => setQuality(v as QualityMode)}
            onClose={() => setOpenDropdown(null)}
          />
        )}
      </div>

      <div className="separator" />

      {/* Zoom dropdown */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button
          className="toolbar-btn"
          onClick={() => setOpenDropdown(openDropdown === 'zoom' ? null : 'zoom')}
          title="Preview zoom (Ctrl+wheel)"
          style={{ fontSize: 12, padding: '3px 8px' }}
        >
          {zoomLabel} <span style={{ fontSize: 10, color: 'var(--text3)' }}>▾</span>
        </button>
        {openDropdown === 'zoom' && (
          <Dropdown
            items={[
              { label: 'Fit', value: 'fit' },
              { label: 'Fill', value: 'fill' },
              ...ZOOM_PRESETS.map((z) => ({ label: `${z}%`, value: String(z) }))
            ].map((item) => {
              const isActive = item.value === 'fit' || item.value === 'fill'
                ? zoomMode === item.value
                : typeof zoomMode === 'number' && zoomMode === parseInt(item.value)
              return { ...item, active: isActive }
            })}
            onSelect={(v) => {
              if (v === 'fit' || v === 'fill') setZoomMode(v)
              else setZoomMode(parseInt(v))
            }}
            onClose={() => setOpenDropdown(null)}
          />
        )}
      </div>

      {/* Fullscreen toggle */}
      <button
        className="toolbar-btn"
        onClick={toggleFullscreen}
        title="Fullscreen preview (Ctrl+Shift+F)"
        style={{ padding: '4px 6px', flexShrink: 0 }}
      >
        {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      </div>{/* end right-side controls */}
    </div>
  )
}

export default PlaybackControls
