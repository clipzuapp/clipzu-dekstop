import { useMemo, useCallback, useEffect } from 'react'
import { useTimeline, DEFAULT_TRANSFORM, type ClipTransform } from '../../store/useTimeline'
import { useProject, type AspectRatio } from '../../store/useProject'
import { formatTime } from '../../utils/format'
import { InspectorHeader } from '../InspectorHeader/index'
import type { RightTabId } from '../RightRail/index'
import { ComingSoonPanel } from '../ComingSoonPanel/index'
import { useCaptionStyleBinding } from './useCaptionStyleBinding'
import * as AudioEngine from '../../services/AudioEngine'
import { linearToDb, dbToLinear } from '../../utils/audio'
import { useSelectedEntity } from '../../store/useSelectedEntity'
import { AlignLeft, AlignCenter, AlignRight, Volume2, VolumeX } from 'lucide-react'
import { KeyframeEditor } from '../KeyframeEditor/index'
import { SliderInputField } from '../SliderInputField/index'
import { AVAILABLE_FONTS } from '../../../shared/utils/fonts'

/**
 * Inspector — context-sensitive property editor.
 * Priority: caption > clip > project settings
 */

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }): JSX.Element {
  return (
    <div className="section-title" style={{ padding: '10px 12px 4px' }}>
      {title}
    </div>
  )
}

const SWATCHES = ['#ffffff', '#facc15', '#4ade80', '#f87171', '#60a5fa']

function SwatchRow({ label, value, onChange }: {
  label: string; value: string; onChange: (c: string) => void
}): JSX.Element {
  return (
    <div style={{ padding: '0 12px' }}>
      <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '4px' }}>{label}</div>
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
            flex: 1, fontSize: '12px', background: 'var(--bg2)', color: 'var(--text2)',
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
  const backgroundColor = useProject((s) => s.backgroundColor)
  const setResolution = useProject((s) => s.setResolution)
  const setFps = useProject((s) => s.setFps)
  const setAspectRatio = useProject((s) => s.setAspectRatio)
  const setBackgroundColor = useProject((s) => s.setBackgroundColor)
  const totalDurationMs = useTimeline((s) => s.totalDurationMs)

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px' }}>
      <h3 className="inspector-header-title" style={{ marginBottom: '4px' }}>Project Settings</h3>

      <section>
        <div className="section-title" style={{ marginBottom: '4px' }}>
          Aspect Ratio
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {Object.entries(ASPECT_PRESETS).map(([key, val]) => (
            <button key={key}
              style={{
                padding: '3px 8px', fontSize: '12px', borderRadius: '3px', cursor: 'pointer',
                background: aspectRatio === key ? 'rgba(79,127,255,0.18)' : 'var(--bg2)',
                color: aspectRatio === key ? 'var(--accent)' : 'var(--text3)',
                border: 'none', transition: 'all 0.15s'
              }}
              onClick={() => { setAspectRatio(key as AspectRatio); setResolution(val.width, val.height) }}>
              {val.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="section-title" style={{ marginBottom: '4px' }}>Resolution (W × H)</div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="number"
            value={resolution.width}
            min={100}
            max={7680}
            onChange={(e) => {
              const w = Math.max(100, Math.min(7680, parseInt(e.target.value) || 1080))
              setResolution(w, resolution.height)
              setAspectRatio('custom')
            }}
            style={{
              width: '70px', fontSize: '12px', background: 'var(--bg2)', color: 'var(--text2)',
              border: '0.5px solid var(--border)', borderRadius: '3px', padding: '3px 6px',
              fontFamily: 'monospace'
            }}
          />
          <span style={{ color: 'var(--text3)' }}>×</span>
          <input
            type="number"
            value={resolution.height}
            min={100}
            max={7680}
            onChange={(e) => {
              const h = Math.max(100, Math.min(7680, parseInt(e.target.value) || 1080))
              setResolution(resolution.width, h)
              setAspectRatio('custom')
            }}
            style={{
              width: '70px', fontSize: '12px', background: 'var(--bg2)', color: 'var(--text2)',
              border: '0.5px solid var(--border)', borderRadius: '3px', padding: '3px 6px',
              fontFamily: 'monospace'
            }}
          />
        </div>
      </section>

      <section>
        <div className="section-title" style={{ marginBottom: '4px' }}>FPS</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {([24, 30, 60] as const).map((f) => (
            <button key={f}
              style={{
                flex: 1, padding: '4px', fontSize: '13px', borderRadius: '3px', cursor: 'pointer',
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
        <div className="section-title" style={{ marginBottom: '4px' }}>Background Color</div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="color"
            value={backgroundColor}
            onChange={(e) => setBackgroundColor(e.target.value)}
            style={{
              width: '28px', height: '28px', border: 'none', borderRadius: '3px',
              cursor: 'pointer', background: 'transparent', padding: 0
            }}
          />
          <input
            type="text"
            value={backgroundColor}
            onChange={(e) => setBackgroundColor(e.target.value)}
            style={{
              flex: 1, fontSize: '12px', background: 'var(--bg2)', color: 'var(--text2)',
              border: '0.5px solid var(--border)', borderRadius: '3px', padding: '3px 6px',
              fontFamily: 'monospace'
            }}
          />
        </div>
      </section>

      <section>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '2px' }}>Duration</div>
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
  const focusedId = useTimeline((s) => s.focusedId)
  const clips = useTimeline((s) => s.clips)
  const setClipTransform = useTimeline((s) => s.setClipTransform)
  const setClipVolume = useTimeline((s) => s.setClipVolume)
  const setClipMute = useTimeline((s) => s.setClipMute)
  const setClipFade = useTimeline((s) => s.setClipFade)

  const selectedClip = useMemo(() => {
    if (!focusedId) return null
    return clips.find((c) => c.id === focusedId) ?? null
  }, [focusedId, clips])

  const selectedClipId = selectedClip?.id ?? null

  const t: ClipTransform = selectedClip?.transform ?? { ...DEFAULT_TRANSFORM }
  const clipVolume = selectedClip?.volume ?? 1
  const clipMuted = selectedClip?.muted ?? false
  const clipDb = linearToDb(clipVolume)

  const update = useCallback((partial: Partial<ClipTransform>) => {
    if (selectedClipId) setClipTransform(selectedClipId, partial)
  }, [selectedClipId, setClipTransform])

  const resetTransform = (): void => {
    if (selectedClipId) setClipTransform(selectedClipId, { ...DEFAULT_TRANSFORM })
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button style={{ fontSize: '12px', color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={resetTransform}>Reset</button>
      </div>

      <SectionHeader title="Transform" />
      <SliderInputField label="Scale" value={Math.round(t.scaleX * 100)} min={5} max={400} step={1} unit="%"
        onChange={(v) => update({ scaleX: v / 100, scaleY: v / 100 })} />
      <SliderInputField label="Rotation" value={t.rotation} min={-180} max={180} step={0.5} unit="°"
        onChange={(v) => update({ rotation: v })} />
      <SliderInputField label="Opacity" value={Math.round(t.opacity * 100)} min={0} max={100} step={1} unit="%"
        onChange={(v) => update({ opacity: v / 100 })} />

      <SectionHeader title="Crop" />
      <SliderInputField label="Crop Top" value={Math.round(t.cropTop * 100)} min={0} max={50} step={1} unit="%"
        onChange={(v) => update({ cropTop: v / 100 })} />
      <SliderInputField label="Crop Bottom" value={Math.round(t.cropBottom * 100)} min={0} max={50} step={1} unit="%"
        onChange={(v) => update({ cropBottom: v / 100 })} />
      <SliderInputField label="Crop Left" value={Math.round(t.cropLeft * 100)} min={0} max={50} step={1} unit="%"
        onChange={(v) => update({ cropLeft: v / 100 })} />
      <SliderInputField label="Crop Right" value={Math.round(t.cropRight * 100)} min={0} max={50} step={1} unit="%"
        onChange={(v) => update({ cropRight: v / 100 })} />

      {/* Audio section — per-clip volume + mute for video clips with embedded audio */}
      <SectionHeader title="Audio" />
      <SliderInputField label="Volume" value={clipDb} min={-30} max={6} step={0.5} unit="dB"
        onChange={(v) => { if (selectedClipId) setClipVolume(selectedClipId, dbToLinear(v)) }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 12px' }}>
        <button
          onClick={() => {
            if (selectedClipId) setClipMute(selectedClipId, !clipMuted)
          }}
          style={{
            padding: '3px 10px', fontSize: '12px', borderRadius: '3px', cursor: 'pointer',
            background: clipMuted ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg2)',
            color: clipMuted ? '#ef4444' : 'var(--text3)',
            border: clipMuted ? '0.5px solid rgba(239, 68, 68, 0.3)' : '0.5px solid var(--border)',
            fontWeight: 500
          }}>
          {clipMuted ? <><VolumeX size={12} /> Muted</> : <><Volume2 size={12} /> Mute</>}
        </button>
      </div>

      <SectionHeader title="Fade" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text3)' }}>Fade In</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="number" min={0} max={30} step={0.1}
            value={((selectedClip?.fadeInMs ?? 0) / 1000).toFixed(1)}
            onChange={(e) => {
              if (selectedClipId) {
                const sec = Math.max(0, parseFloat(e.target.value) || 0)
                setClipFade(selectedClipId, Math.round(sec * 1000), selectedClip?.fadeOutMs ?? 0)
              }
            }}
            style={{
              width: '48px', padding: '2px 4px', fontSize: '12px', borderRadius: '3px',
              background: 'var(--bg2)', color: 'var(--text1)', border: '0.5px solid var(--border)',
              fontFamily: 'monospace', textAlign: 'right'
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text3)' }}>s</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text3)' }}>Fade Out</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="number" min={0} max={30} step={0.1}
            value={((selectedClip?.fadeOutMs ?? 0) / 1000).toFixed(1)}
            onChange={(e) => {
              if (selectedClipId) {
                const sec = Math.max(0, parseFloat(e.target.value) || 0)
                setClipFade(selectedClipId, selectedClip?.fadeInMs ?? 0, Math.round(sec * 1000))
              }
            }}
            style={{
              width: '48px', padding: '2px 4px', fontSize: '12px', borderRadius: '3px',
              background: 'var(--bg2)', color: 'var(--text1)', border: '0.5px solid var(--border)',
              fontFamily: 'monospace', textAlign: 'right'
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text3)' }}>s</span>
        </div>
      </div>

      {/* Keyframe Editor */}
      <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: '8px' }}>
        <KeyframeEditor />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Caption Style Tab (rightTab='basic' + caption/textClip selected)
// ---------------------------------------------------------------------------

const FONT_OPTIONS = AVAILABLE_FONTS
const ANIM_PRESETS: Array<'none' | 'pop' | 'fade' | 'slide-up' | 'karaoke' | 'typewriter'> = [
  'pop', 'fade', 'slide-up', 'karaoke', 'typewriter', 'none'
]

function CaptionStyleTab(): JSX.Element {
  const { effectiveStyle, applyStyleToSelected, applyStyleToAllOnLayer } = useCaptionStyleBinding()

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
      {/* Font */}
      <SectionHeader title="Style" />

      <div style={{ padding: '0 12px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '4px' }}>Font Family</div>
        <select value={effectiveStyle.fontFamily}
          onChange={(e) => applyStyleToSelected({ fontFamily: e.target.value })}
          style={{
            width: '100%', fontSize: '13px', background: 'var(--bg2)', color: 'var(--text2)',
            border: '0.5px solid var(--border)', borderRadius: '3px', padding: '4px'
          }}>
          {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <SliderInputField label="Font Size" value={effectiveStyle.fontSize} min={12} max={120} step={1} unit="px"
        debounceMs={50} onChange={(v) => applyStyleToSelected({ fontSize: v })} />
      <SliderInputField label="Font Weight" value={effectiveStyle.fontWeight} min={300} max={900} step={100}
        debounceMs={50} onChange={(v) => applyStyleToSelected({ fontWeight: v })} />

      {/* Colors */}
      <SwatchRow label="Text Color" value={effectiveStyle.color} onChange={(c) => applyStyleToSelected({ color: c })} />
      <SwatchRow label="Stroke Color" value={effectiveStyle.strokeColor} onChange={(c) => applyStyleToSelected({ strokeColor: c })} />

      <SliderInputField label="Stroke Width" value={effectiveStyle.strokeWidth} min={0} max={10} step={0.5} unit="px"
        debounceMs={50} onChange={(v) => applyStyleToSelected({ strokeWidth: v })} />

      {/* Alignment */}
      <div style={{ padding: '0 12px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text3)', marginBottom: '4px' }}>Alignment</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a}
              onClick={() => applyStyleToSelected({ alignment: a })}
              style={{
                flex: 1, padding: '4px', fontSize: '13px', borderRadius: '3px', cursor: 'pointer',
                background: effectiveStyle.alignment === a ? 'rgba(79,127,255,0.2)' : 'var(--bg2)',
                color: effectiveStyle.alignment === a ? 'var(--accent)' : 'var(--text3)',
                border: effectiveStyle.alignment === a ? '0.5px solid rgba(79,127,255,0.4)' : '0.5px solid var(--border)',
              }}>
              {a === 'left' ? <AlignLeft size={14} /> : a === 'right' ? <AlignRight size={14} /> : <AlignCenter size={14} />}
            </button>
          ))}
        </div>
      </div>

      {/* Background */}
      <SectionHeader title="Background" />
      <SliderInputField label="BG Opacity" value={Math.round(effectiveStyle.bgOpacity * 100)} min={0} max={100} step={1} unit="%"
        debounceMs={50} onChange={(v) => applyStyleToSelected({ bgOpacity: v / 100 })} />

      {/* Caption Mode */}
      <SectionHeader title="Caption Mode" />
      <div style={{ padding: '0 12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
          {(['full-phrase', 'word-reveal', 'karaoke', 'single-word'] as const).map((mode) => (
            <button key={mode}
              onClick={() => applyStyleToSelected({ captionMode: mode })}
              style={{
                padding: '4px 2px', fontSize: '12px', borderRadius: '3px', cursor: 'pointer',
                background: effectiveStyle.captionMode === mode ? 'rgba(79,127,255,0.2)' : 'var(--bg2)',
                color: effectiveStyle.captionMode === mode ? 'var(--accent)' : 'var(--text3)',
                border: effectiveStyle.captionMode === mode
                  ? '0.5px solid rgba(79,127,255,0.4)'
                  : '0.5px solid var(--border)',
                textTransform: 'capitalize'
              }}>
              {mode.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Reveal Fade (word-reveal only) */}
      {effectiveStyle.captionMode === 'word-reveal' && (
        <>
          <SectionHeader title="Reveal Fade" />
          <SliderInputField label="Fade Duration" value={effectiveStyle.revealFadeMs ?? 0} min={0} max={200} step={10} unit="ms"
            onChange={(v) => applyStyleToSelected({ revealFadeMs: v })} />
        </>
      )}

      {/* Active State — visible only for modes that have an active element */}
      {(effectiveStyle.captionMode === 'karaoke' || effectiveStyle.captionMode === 'single-word') && (
        <>
          <SectionHeader title="Active State" />

          {/* Highlight Color */}
          <SwatchRow
            label="Highlight Color"
            value={effectiveStyle.activeHighlightColor ?? '#FFD700'}
            onChange={(c) => applyStyleToSelected({ activeHighlightColor: c })}
          />

          {/* Text Color */}
          <SwatchRow
            label="Text Color"
            value={effectiveStyle.activeTextColor ?? '#000000'}
            onChange={(c) => applyStyleToSelected({ activeTextColor: c })}
          />

          {/* Scale */}
          <SliderInputField label="Active Scale" value={Math.round((effectiveStyle.activeScale ?? 1) * 100)} min={50} max={200} step={5} unit="%"
            onChange={(v) => applyStyleToSelected({ activeScale: v / 100 })} />
        </>
      )}

      {/* Position */}
      <SectionHeader title="Position" />
      <SliderInputField label="Position X" value={effectiveStyle.x} min={0} max={100} step={1} unit="%"
        debounceMs={50} onChange={(v) => applyStyleToSelected({ x: v })} />
      <SliderInputField label="Position Y" value={effectiveStyle.y} min={0} max={100} step={1} unit="%"
        debounceMs={50} onChange={(v) => applyStyleToSelected({ y: v })} />

      {/* Apply to All on Layer */}
      <div style={{ padding: '0 12px' }}>
        <button
          onClick={applyStyleToAllOnLayer}
          style={{
            width: '100%', padding: '6px 8px', fontSize: '12px', borderRadius: '4px', cursor: 'pointer',
            background: 'rgba(79,127,255,0.12)', color: 'var(--accent)',
            border: '0.5px solid rgba(79,127,255,0.3)', textTransform: 'uppercase',
            letterSpacing: '0.04em', fontWeight: 600
          }}
        >
          Apply Style to All Captions on This Layer
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Caption Animation Tab (rightTab='animation' + caption/textClip selected)
// ---------------------------------------------------------------------------

function CaptionAnimationTab(): JSX.Element {
  const { effectiveStyle, applyStyleToSelected } = useCaptionStyleBinding()
  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const focusedId = useTimeline((s) => s.focusedId)
  const textClips = useTimeline((s) => s.textClips)

  const selectedTextClipId = useMemo(() => {
    if (!focusedId) return null
    return textClips.some((tc) => tc.id === focusedId) ? focusedId : null
  }, [focusedId, textClips])

  /** Apply animation and seek to caption start so the user sees the entry animation immediately */
  const applyAndPreview = useCallback((preset: typeof effectiveStyle.animation) => {
    applyStyleToSelected({ animation: preset })
    if (selectedTextClipId) {
      const clip = textClips.find((tc) => tc.id === selectedTextClipId)
      if (clip) setPlayhead(clip.startMs)
    }
  }, [applyStyleToSelected, selectedTextClipId, textClips, setPlayhead])

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
      <SectionHeader title="Animation" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', padding: '0 12px' }}>
        {ANIM_PRESETS.map((preset) => (
          <button key={preset}
            onClick={() => applyAndPreview(preset)}
            style={{
              padding: '4px 2px', fontSize: '12px', borderRadius: '3px', cursor: 'pointer',
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

  // Real-time AudioEngine gain sync — when volume/mute changes, update GainNode immediately
  useEffect(() => {
    for (const track of audioTracks) {
      AudioEngine.setTrackVol(track.id, track.volume, track.muted)
    }
  }, [audioTracks])

  if (audioTracks.length === 0) {
    return (
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '13px', color: 'var(--text3)' }}>No audio tracks</span>
        <span style={{ fontSize: '12px', color: 'var(--text3)', opacity: 0.6 }}>Import audio in the Media panel</span>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
      <SectionHeader title="Audio Tracks" />
      {audioTracks.map((track) => {
        const trackDb = linearToDb(track.volume)
        return (
          <div key={track.id} style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: '12px', color: 'var(--text2)', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px'
            }}>
              {track.name || 'Audio Track'}
            </span>
            <button
              onClick={() => toggleAudioMute(track.id)}
              style={{
                padding: '2px 6px', fontSize: '11px', borderRadius: '3px', cursor: 'pointer',
                background: track.muted ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg2)',
                color: track.muted ? '#ef4444' : 'var(--text3)',
                border: track.muted ? '0.5px solid rgba(239, 68, 68, 0.3)' : '0.5px solid var(--border)',
              }}>
              {track.muted ? <><VolumeX size={12} /> Muted</> : <><Volume2 size={12} /> M</>}
            </button>
          </div>
          <SliderInputField label={track.name || 'Audio Track'} value={trackDb} min={-30} max={6} step={0.5} unit="dB"
            onChange={(v) => setAudioVolume(track.id, dbToLinear(v))} />
        </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speed Tab (rightTab='speed')
// ---------------------------------------------------------------------------

function SpeedTab(): JSX.Element {
  const focusedId = useTimeline((s) => s.focusedId)
  const clips = useTimeline((s) => s.clips)
  const setClipSpeed = useTimeline((s) => s.setClipSpeed)

  const selectedClip = useMemo(() => {
    if (!focusedId) return null
    return clips.find((c) => c.id === focusedId) ?? null
  }, [focusedId, clips])

  const selectedClipId = selectedClip?.id ?? null

  if (!selectedClip) {
    return (
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '13px', color: 'var(--text3)' }}>Select a clip to adjust speed</span>
      </div>
    )
  }

  const speed = selectedClip.speed ?? 1.0

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
      <SectionHeader title="Clip Speed" />

      <SliderInputField label="Speed" value={Math.round(speed * 100)} min={25} max={400} step={1} unit="%"
        onChange={(v) => setClipSpeed(selectedClipId!, v / 100)} />

      <div style={{ padding: '0 12px', display: 'flex', gap: '4px' }}>
        {[0.5, 1.0, 1.5, 2.0].map((preset) => (
          <button key={preset}
            onClick={() => setClipSpeed(selectedClipId!, preset)}
            style={{
              flex: 1, padding: '4px', fontSize: '12px', borderRadius: '3px', cursor: 'pointer',
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
// Audio Track Basic Tab (audio/SFX track selected, basic tab)
// ---------------------------------------------------------------------------

function AudioTrackBasicTab({ trackId }: { trackId: string }): JSX.Element {
  const audioTracks = useTimeline((s) => s.audioTracks)
  const setAudioVolume = useTimeline((s) => s.setAudioVolume)
  const toggleAudioMute = useTimeline((s) => s.toggleAudioMute)
  const setAudioFade = useTimeline((s) => s.setAudioFade)

  const track = audioTracks.find((a) => a.id === trackId)
  if (!track) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <span style={{ fontSize: '13px', color: 'var(--text3)' }}>Audio track not found</span>
      </div>
    )
  }

  const trackDb = linearToDb(track.volume)

  const handleVolumeChange = (vol: number): void => {
    setAudioVolume(trackId, vol)
    // Real-time gain update — no playback restart needed
    AudioEngine.setTrackVol(trackId, vol, track.muted)
  }

  const handleMuteToggle = (): void => {
    toggleAudioMute(trackId)
    const newMuted = !track.muted
    AudioEngine.setTrackVol(trackId, track.volume, newMuted)
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: '14px', fontWeight: 600, color: 'var(--text1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px'
        }}>
          {track.name || 'Audio Track'}
        </span>
        <span style={{
          fontSize: '11px', padding: '2px 6px', borderRadius: '3px',
          background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80',
          textTransform: 'uppercase', letterSpacing: '0.04em'
        }}>
          {track.role}
        </span>
      </div>

      <SectionHeader title="Audio" />
      <SliderInputField label="Volume" value={trackDb} min={-30} max={6} step={0.5} unit="dB"
        onChange={(v) => handleVolumeChange(dbToLinear(v))} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 12px' }}>
        <button
          onClick={handleMuteToggle}
          style={{
            padding: '3px 10px', fontSize: '12px', borderRadius: '3px', cursor: 'pointer',
            background: track.muted ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg2)',
            color: track.muted ? '#ef4444' : 'var(--text3)',
            border: track.muted ? '0.5px solid rgba(239, 68, 68, 0.3)' : '0.5px solid var(--border)',
            fontWeight: 500
          }}>
          {track.muted ? <><VolumeX size={12} /> Muted</> : <><Volume2 size={12} /> Mute</>}
        </button>
      </div>

      <SectionHeader title="Fade" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text3)' }}>Fade In</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="number" min={0} max={30} step={0.1}
            value={((track.fadeInMs ?? 0) / 1000).toFixed(1)}
            onChange={(e) => {
              const sec = Math.max(0, parseFloat(e.target.value) || 0)
              setAudioFade(trackId, Math.round(sec * 1000), track.fadeOutMs ?? 0)
            }}
            style={{
              width: '52px', padding: '2px 4px', fontSize: '12px', borderRadius: '3px',
              background: 'var(--bg2)', color: 'var(--text1)', border: '0.5px solid var(--border)',
              fontFamily: 'monospace', textAlign: 'right'
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text3)' }}>s</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
        <span style={{ fontSize: '12px', color: 'var(--text3)' }}>Fade Out</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="number" min={0} max={30} step={0.1}
            value={((track.fadeOutMs ?? 0) / 1000).toFixed(1)}
            onChange={(e) => {
              const sec = Math.max(0, parseFloat(e.target.value) || 0)
              setAudioFade(trackId, track.fadeInMs ?? 0, Math.round(sec * 1000))
            }}
            style={{
              width: '52px', padding: '2px 4px', fontSize: '12px', borderRadius: '3px',
              background: 'var(--bg2)', color: 'var(--text1)', border: '0.5px solid var(--border)',
              fontFamily: 'monospace', textAlign: 'right'
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text3)' }}>s</span>
        </div>
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
  const { selectedClipId, selectedTextClipId, selectedAudioTrackId } = useSelectedEntity()

  const hasCaption = Boolean(selectedTextClipId)
  const hasClip = Boolean(selectedClipId)
  const hasTextClip = Boolean(selectedTextClipId)
  const hasAudioTrack = Boolean(selectedAudioTrackId)

  const renderTabContent = (): JSX.Element => {
    switch (rightTab) {
      case 'basic':
        if (hasCaption || hasTextClip) return <CaptionStyleTab />
        if (hasClip) return <ClipBasicTab />
        if (hasAudioTrack) return <AudioTrackBasicTab trackId={selectedAudioTrackId!} />
        return <ProjectSettings />

      case 'animation':
        if (hasCaption || hasTextClip) return <CaptionAnimationTab />
        if (hasClip || hasAudioTrack) return <KeyframeEditor />
        return <div className="px-3 py-4 text-center text-[11px] text-gray-500">Select a clip to edit keyframes</div>

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
    <div className="inspector-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <InspectorHeader />
      <div className="inspector-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {renderTabContent()}
      </div>
    </div>
  )
}

export default Inspector
