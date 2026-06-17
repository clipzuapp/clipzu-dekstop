import { useMemo, useCallback, useState, useEffect } from 'react'
import { useTimeline, DEFAULT_TRANSFORM, type ClipTransform } from '../../store/useTimeline'
import { useProject } from '../../store/useProject'
import { formatTime } from '../../utils/format'
import { InspectorHeader } from '../InspectorHeader/index'
import type { RightTabId } from '../RightRail/index'
import { ComingSoonPanel } from '../ComingSoonPanel/index'
import { useCaptionStyleBinding } from './useCaptionStyleBinding'

/**
 * Inspector — context-sensitive property editor.
 * Priority: caption > clip > project settings
 */

// ---------------------------------------------------------------------------
// Debounce helper
// ---------------------------------------------------------------------------

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }): JSX.Element {
  return (
    <div style={{
      fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase',
      letterSpacing: '0.06em', padding: '10px 12px 4px'
    }}>
      {title}
    </div>
  )
}

function SliderRow({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void
}): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px' }}>
      <span style={{ width: '80px', fontSize: '10px', color: 'var(--text3)', flexShrink: 0, fontFamily: 'monospace' }}>
        {label}
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--accent)', height: '4px' }}
      />
    </div>
  )
}

const SWATCHES = ['#ffffff', '#facc15', '#4ade80', '#f87171', '#60a5fa']

function SwatchRow({ label, value, onChange }: {
  label: string; value: string; onChange: (c: string) => void
}): JSX.Element {
  return (
    <div style={{ padding: '0 12px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '4px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            style={{
              width: '18px', height: '18px', borderRadius: '3px', cursor: 'pointer',
              background: c,
              border: value === c ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.2)',
              transition: 'border 0.1s'
            }}
          />
        ))}
        <input
          type="text" value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, fontSize: '10px', background: 'var(--bg2)', color: 'var(--text2)',
            border: '0.5px solid var(--border)', borderRadius: '3px', padding: '2px 4px',
            fontFamily: 'monospace', minWidth: 0
          }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project Settings (nothing selected)
// ---------------------------------------------------------------------------

const ASPECT_PRESETS: Record<string, { width: number; height: number; label: string }> = {
  '9:16': { width: 1080, height: 1920, label: '9:16' },
  '16:9': { width: 1920, height: 1080, label: '16:9' },
  '1:1':  { width: 1080, height: 1080, label: '1:1'  },
  '4:5':  { width: 1080, height: 1350, label: '4:5'  },
  '4:3':  { width: 1440, height: 1080, label: '4:3'  }
}

function ProjectSettings(): JSX.Element {
  const resolution = useProject((s) => s.resolution)
  const fps = useProject((s) => s.fps)
  const aspectRatio = useProject((s) => s.aspectRatio)
  const setResolution = useProject((s) => s.setResolution)
  const setFps = useProject((s) => s.setFps)
  const setAspectRatio = useProject((s) => s.setAspectRatio)
  const totalDurationMs = useTimeline((s) => s.totalDurationMs)

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '11px' }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text1)', margin: 0 }}>Project Settings</h3>

      <section>
        <div style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
          Aspect Ratio
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {Object.entries(ASPECT_PRESETS).map(([key, val]) => (
            <button key={key}
              style={{
                padding: '3px 8px', fontSize: '10px', borderRadius: '3px', cursor: 'pointer',
                background: aspectRatio === key ? 'rgba(79,127,255,0.18)' : 'var(--bg2)',
                color: aspectRatio === key ? 'var(--accent)' : 'var(--text3)',
                border: 'none', transition: 'all 0.15s'
              }}
              onClick={() => { setAspectRatio(key as any); setResolution(val.width, val.height) }}>
              {val.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '2px' }}>Resolution</div>
        <div style={{ color: 'var(--text2)' }}>{resolution.width} × {resolution.height}</div>
      </section>

      <section>
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '4px' }}>FPS</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {([24, 30, 60] as const).map((f) => (
            <button key={f}
              style={{
                flex: 1, padding: '4px', fontSize: '11px', borderRadius: '3px', cursor: 'pointer',
                background: fps === f ? 'var(--accent)' : 'var(--bg2)',
                color: fps === f ? '#fff' : 'var(--text3)',
                border: 'none', transition: 'all 0.15s'
              }}
              onClick={() => setFps(f)}>
              {f}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '2px' }}>Duration</div>
        <div style={{ color: 'var(--text2)', fontFamily: 'monospace' }}>{formatTime(totalDurationMs)}</div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Clip Inspector (video clip selected)
// ---------------------------------------------------------------------------

/**
 * ClipBasicTab — Transform + Crop controls for selected video clip.
 * Header/timing is rendered by InspectorHeader above.
 */
function ClipBasicTab(): JSX.Element {
  const selectedClipId = useTimeline((s) => s.selectedClipId)
  const setClipTransform = useTimeline((s) => s.setClipTransform)

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null
    return useTimeline.getState().clips.find((c) => c.id === selectedClipId) ?? null
  }, [selectedClipId])

  const t: ClipTransform = selectedClip?.transform ?? { ...DEFAULT_TRANSFORM }

  const update = useCallback((partial: Partial<ClipTransform>) => {
    if (selectedClipId) setClipTransform(selectedClipId, partial)
  }, [selectedClipId, setClipTransform])

  const resetTransform = (): void => {
    if (selectedClipId) setClipTransform(selectedClipId, { ...DEFAULT_TRANSFORM })
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '11px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button style={{ fontSize: '10px', color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={resetTransform}>Reset</button>
      </div>

      <SectionHeader title="Transform" />
      <SliderRow label={`${Math.round(t.scaleX * 100)}%`} min={5} max={400} step={1}
        value={Math.round(t.scaleX * 100)}
        onChange={(v) => update({ scaleX: v / 100, scaleY: v / 100 })} />
      <SliderRow label={`Rot ${t.rotation.toFixed(1)}°`} min={-180} max={180} step={0.5}
        value={t.rotation} onChange={(v) => update({ rotation: v })} />
      <SliderRow label={`Opacity ${Math.round(t.opacity * 100)}%`} min={0} max={100} step={1}
        value={Math.round(t.opacity * 100)} onChange={(v) => update({ opacity: v / 100 })} />

      <SectionHeader title="Crop" />
      <SliderRow label={`Top ${Math.round(t.cropTop * 100)}%`} min={0} max={50} step={1}
        value={Math.round(t.cropTop * 100)} onChange={(v) => update({ cropTop: v / 100 })} />
      <SliderRow label={`Bot ${Math.round(t.cropBottom * 100)}%`} min={0} max={50} step={1}
        value={Math.round(t.cropBottom * 100)} onChange={(v) => update({ cropBottom: v / 100 })} />
      <SliderRow label={`Left ${Math.round(t.cropLeft * 100)}%`} min={0} max={50} step={1}
        value={Math.round(t.cropLeft * 100)} onChange={(v) => update({ cropLeft: v / 100 })} />
      <SliderRow label={`Right ${Math.round(t.cropRight * 100)}%`} min={0} max={50} step={1}
        value={Math.round(t.cropRight * 100)} onChange={(v) => update({ cropRight: v / 100 })} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Caption Style Tab (rightTab='basic' + caption/textClip selected)
// ---------------------------------------------------------------------------

const FONT_OPTIONS = ['Inter', 'Arial', 'Roboto', 'Impact', 'Oswald']
const ANIM_PRESETS: Array<'none' | 'pop' | 'fade' | 'slide-up' | 'karaoke' | 'typewriter'> = [
  'pop', 'fade', 'slide-up', 'karaoke', 'typewriter', 'none'
]

function CaptionStyleTab(): JSX.Element {
  const { effectiveStyle, applyStyleToSelected } = useCaptionStyleBinding()

  // Debounced sliders — local state for immediate feedback, debounced store write
  const [localFontSize, setLocalFontSize] = useState(effectiveStyle.fontSize)
  const [localFontWeight, setLocalFontWeight] = useState(effectiveStyle.fontWeight)
  const [localStrokeWidth, setLocalStrokeWidth] = useState(effectiveStyle.strokeWidth)
  const [localBgOpacity, setLocalBgOpacity] = useState(Math.round(effectiveStyle.bgOpacity * 100))
  const [localX, setLocalX] = useState(effectiveStyle.x)
  const [localY, setLocalY] = useState(effectiveStyle.y)

  // Sync local state when effective style changes (clip selection change, external edits)
  useEffect(() => { setLocalFontSize(effectiveStyle.fontSize) }, [effectiveStyle.fontSize])
  useEffect(() => { setLocalFontWeight(effectiveStyle.fontWeight) }, [effectiveStyle.fontWeight])
  useEffect(() => { setLocalStrokeWidth(effectiveStyle.strokeWidth) }, [effectiveStyle.strokeWidth])
  useEffect(() => { setLocalBgOpacity(Math.round(effectiveStyle.bgOpacity * 100)) }, [effectiveStyle.bgOpacity])
  useEffect(() => { setLocalX(effectiveStyle.x) }, [effectiveStyle.x])
  useEffect(() => { setLocalY(effectiveStyle.y) }, [effectiveStyle.y])

  const debouncedFontSize = useMemo(() => debounce((v: number) => applyStyleToSelected({ fontSize: v }), 50), [applyStyleToSelected])
  const debouncedFontWeight = useMemo(() => debounce((v: number) => applyStyleToSelected({ fontWeight: v }), 50), [applyStyleToSelected])
  const debouncedStrokeWidth = useMemo(() => debounce((v: number) => applyStyleToSelected({ strokeWidth: v }), 50), [applyStyleToSelected])
  const debouncedBgOpacity = useMemo(() => debounce((v: number) => applyStyleToSelected({ bgOpacity: v / 100 }), 50), [applyStyleToSelected])
  const debouncedX = useMemo(() => debounce((v: number) => applyStyleToSelected({ x: v }), 50), [applyStyleToSelected])
  const debouncedY = useMemo(() => debounce((v: number) => applyStyleToSelected({ y: v }), 50), [applyStyleToSelected])

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '11px' }}>
      {/* Font */}
      <SectionHeader title="Style" />

      <div style={{ padding: '0 12px' }}>
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '4px' }}>Font Family</div>
        <select value={effectiveStyle.fontFamily}
          onChange={(e) => applyStyleToSelected({ fontFamily: e.target.value })}
          style={{
            width: '100%', fontSize: '11px', background: 'var(--bg2)', color: 'var(--text2)',
            border: '0.5px solid var(--border)', borderRadius: '3px', padding: '4px'
          }}>
          {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div style={{ padding: '0 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>Font Size</span>
          <span style={{ fontSize: '10px', color: 'var(--text1)', fontFamily: 'monospace' }}>{localFontSize}px</span>
        </div>
        <input type="range" min={12} max={120} value={localFontSize}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value)
            setLocalFontSize(v)
            debouncedFontSize(v)
          }}
          style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </div>

      <div style={{ padding: '0 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>Font Weight</span>
          <span style={{ fontSize: '10px', color: 'var(--text1)', fontFamily: 'monospace' }}>{localFontWeight}</span>
        </div>
        <input type="range" min={300} max={900} step={100} value={localFontWeight}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value)
            setLocalFontWeight(v)
            debouncedFontWeight(v)
          }}
          style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </div>

      {/* Colors */}
      <SwatchRow label="Text Color" value={effectiveStyle.color} onChange={(c) => applyStyleToSelected({ color: c })} />
      <SwatchRow label="Stroke Color" value={effectiveStyle.strokeColor} onChange={(c) => applyStyleToSelected({ strokeColor: c })} />

      <div style={{ padding: '0 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>Stroke Width</span>
          <span style={{ fontSize: '10px', color: 'var(--text1)', fontFamily: 'monospace' }}>{localStrokeWidth}px</span>
        </div>
        <input type="range" min={0} max={10} step={0.5} value={localStrokeWidth}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value)
            setLocalStrokeWidth(v)
            debouncedStrokeWidth(v)
          }}
          style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </div>

      {/* Alignment */}
      <div style={{ padding: '0 12px' }}>
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '4px' }}>Alignment</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a}
              onClick={() => applyStyleToSelected({ alignment: a })}
              style={{
                flex: 1, padding: '4px', fontSize: '11px', borderRadius: '3px', cursor: 'pointer',
                background: effectiveStyle.alignment === a ? 'rgba(79,127,255,0.2)' : 'var(--bg2)',
                color: effectiveStyle.alignment === a ? 'var(--accent)' : 'var(--text3)',
                border: effectiveStyle.alignment === a ? '0.5px solid rgba(79,127,255,0.4)' : '0.5px solid var(--border)',
              }}>
              {a === 'left' ? '⟵' : a === 'right' ? '⟶' : '⎯'}
            </button>
          ))}
        </div>
      </div>

      {/* Background */}
      <SectionHeader title="Background" />
      <div style={{ padding: '0 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>BG Opacity</span>
          <span style={{ fontSize: '10px', color: 'var(--text1)', fontFamily: 'monospace' }}>{localBgOpacity}%</span>
        </div>
        <input type="range" min={0} max={100} value={localBgOpacity}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value)
            setLocalBgOpacity(v)
            debouncedBgOpacity(v)
          }}
          style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </div>

      {/* Position */}
      <SectionHeader title="Position" />
      <div style={{ padding: '0 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>X</span>
          <span style={{ fontSize: '10px', color: 'var(--text1)', fontFamily: 'monospace' }}>{localX}%</span>
        </div>
        <input type="range" min={0} max={100} value={localX}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value)
            setLocalX(v)
            debouncedX(v)
          }}
          style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </div>
      <div style={{ padding: '0 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>Y</span>
          <span style={{ fontSize: '10px', color: 'var(--text1)', fontFamily: 'monospace' }}>{localY}%</span>
        </div>
        <input type="range" min={0} max={100} value={localY}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value)
            setLocalY(v)
            debouncedY(v)
          }}
          style={{ width: '100%', accentColor: 'var(--accent)' }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Caption Animation Tab (rightTab='animation' + caption/textClip selected)
// ---------------------------------------------------------------------------

function CaptionAnimationTab(): JSX.Element {
  const { effectiveStyle, applyStyleToSelected } = useCaptionStyleBinding()

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '11px' }}>
      <SectionHeader title="Animation" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', padding: '0 12px' }}>
        {ANIM_PRESETS.map((preset) => (
          <button key={preset}
            onClick={() => applyStyleToSelected({ animation: preset })}
            style={{
              padding: '4px 2px', fontSize: '10px', borderRadius: '3px', cursor: 'pointer',
              background: effectiveStyle.animation === preset ? 'rgba(79,127,255,0.2)' : 'var(--bg2)',
              color: effectiveStyle.animation === preset ? 'var(--accent)' : 'var(--text3)',
              border: effectiveStyle.animation === preset
                ? '0.5px solid rgba(79,127,255,0.4)'
                : '0.5px solid var(--border)',
              textTransform: 'capitalize'
            }}>
            {preset}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Audio Tab (rightTab='audio')
// ---------------------------------------------------------------------------

function AudioTab(): JSX.Element {
  const audioTracks = useTimeline((s) => s.audioTracks)
  const setAudioVolume = useTimeline((s) => s.setAudioVolume)
  const toggleAudioMute = useTimeline((s) => s.toggleAudioMute)

  if (audioTracks.length === 0) {
    return (
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text3)' }}>No audio tracks</span>
        <span style={{ fontSize: '10px', color: 'var(--text3)', opacity: 0.6 }}>Import audio in the Media panel</span>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '11px' }}>
      <SectionHeader title="Audio Tracks" />
      {audioTracks.map((track) => (
        <div key={track.id} style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: '10px', color: 'var(--text2)', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px'
            }}>
              {track.name || 'Audio Track'}
            </span>
            <button
              onClick={() => toggleAudioMute(track.id)}
              style={{
                padding: '2px 6px', fontSize: '9px', borderRadius: '3px', cursor: 'pointer',
                background: track.muted ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg2)',
                color: track.muted ? '#ef4444' : 'var(--text3)',
                border: track.muted ? '0.5px solid rgba(239, 68, 68, 0.3)' : '0.5px solid var(--border)',
              }}>
              {track.muted ? 'Muted' : 'M'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text3)', width: '36px', fontFamily: 'monospace' }}>
              {Math.round(track.volume * 100)}%
            </span>
            <input
              type="range" min={0} max={100} step={1}
              value={Math.round(track.volume * 100)}
              onChange={(e) => setAudioVolume(track.id, parseInt(e.target.value) / 100)}
              style={{ flex: 1, accentColor: 'var(--accent)', height: '4px' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speed Tab (rightTab='speed')
// ---------------------------------------------------------------------------

function SpeedTab(): JSX.Element {
  const selectedClipId = useTimeline((s) => s.selectedClipId)
  const setClipSpeed = useTimeline((s) => s.setClipSpeed)

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null
    return useTimeline.getState().clips.find((c) => c.id === selectedClipId) ?? null
  }, [selectedClipId])

  if (!selectedClip) {
    return (
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text3)' }}>Select a clip to adjust speed</span>
      </div>
    )
  }

  const speed = selectedClip.speed ?? 1.0

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '11px' }}>
      <SectionHeader title="Clip Speed" />

      <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>Speed</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text1)', fontFamily: 'monospace' }}>
            {speed.toFixed(2)}×
          </span>
        </div>
        <input
          type="range" min={25} max={400} step={1}
          value={Math.round(speed * 100)}
          onChange={(e) => setClipSpeed(selectedClipId!, parseInt(e.target.value) / 100)}
          style={{ width: '100%', accentColor: 'var(--accent)', height: '4px' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text3)' }}>
          <span>0.25×</span><span>1.0×</span><span>2.0×</span><span>4.0×</span>
        </div>
      </div>

      <div style={{ padding: '0 12px', display: 'flex', gap: '4px' }}>
        {[0.5, 1.0, 1.5, 2.0].map((preset) => (
          <button key={preset}
            onClick={() => setClipSpeed(selectedClipId!, preset)}
            style={{
              flex: 1, padding: '4px', fontSize: '10px', borderRadius: '3px', cursor: 'pointer',
              background: speed === preset ? 'rgba(79,127,255,0.2)' : 'var(--bg2)',
              color: speed === preset ? 'var(--accent)' : 'var(--text3)',
              border: speed === preset ? '0.5px solid rgba(79,127,255,0.4)' : '0.5px solid var(--border)',
              fontFamily: 'monospace'
            }}>
            {preset}×
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inspector shell — rightTab switches content; InspectorHeader is persistent
// ---------------------------------------------------------------------------

interface InspectorProps {
  rightTab: RightTabId
}

export function Inspector({ rightTab }: InspectorProps): JSX.Element {
  const selectedTextClipId = useTimeline((s) => s.selectedTextClipId)
  const selectedClipId = useTimeline((s) => s.selectedClipId)

  const hasCaption = Boolean(selectedTextClipId)
  const hasClip = Boolean(selectedClipId)
  const hasTextClip = Boolean(selectedTextClipId)

  const renderTabContent = (): JSX.Element => {
    switch (rightTab) {
      case 'basic':
        if (hasCaption || hasTextClip) return <CaptionStyleTab />
        if (hasClip) return <ClipBasicTab />
        return <ProjectSettings />

      case 'animation':
        if (hasCaption || hasTextClip) return <CaptionAnimationTab />
        return <ComingSoonPanel label="Animation" />

      case 'audio':
        return <AudioTab />

      case 'speed':
        return <SpeedTab />

      case 'background':
        return <ComingSoonPanel label="Background" />

      case 'smart-tools':
        return <ComingSoonPanel label="Smart Tools" />

      default:
        return <ProjectSettings />
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <InspectorHeader />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {renderTabContent()}
      </div>
    </div>
  )
}

export default Inspector
