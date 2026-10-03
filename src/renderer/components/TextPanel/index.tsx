import { useTimeline, createTextClip } from '../../store/useTimeline'
import { defaultStyle, type CaptionStyle } from '../../store/useCaption'
import { laneForManualText } from '../../../shared/captions/lanes'
import { Type } from 'lucide-react'

interface TextPreset {
  label: string
  fontSize: number
  fontWeight: number
  animation: CaptionStyle['animation']
  description: string
}

const TEXT_PRESETS: TextPreset[] = [
  { label: 'Title', fontSize: 56, fontWeight: 700, animation: 'pop', description: 'Bold title overlay' },
  { label: 'Subtitle', fontSize: 32, fontWeight: 500, animation: 'fade', description: 'Lower-third subtitle' },
  { label: 'Caption', fontSize: 28, fontWeight: 400, animation: 'none', description: 'Standard caption text' },
  { label: 'Karaoke', fontSize: 36, fontWeight: 600, animation: 'karaoke', description: 'Word-by-word highlight' }
]

/**
 * TextPanel — quick-add text presets for the left-rail Text tab.
 * Each card creates a TextClip at the playhead with a preset style.
 */
export function TextPanel(): JSX.Element {
  const handleAddPreset = (preset: TextPreset): void => {
    const st = useTimeline.getState()
    const { playheadMs, totalDurationMs } = st
    const durationMs = Math.min(3000, Math.max(500, totalDurationMs - playheadMs))

    const clip = createTextClip({
      text: preset.label,
      startMs: playheadMs,
      durationMs,
      endMs: playheadMs + durationMs,
      // P2.1: manual text takes the first free lane, never silently lane 0.
      trackIndex: laneForManualText(st.textClips),
      style: {
        ...defaultStyle,
        fontSize: preset.fontSize,
        fontWeight: preset.fontWeight,
        animation: preset.animation
      }
    })

    useTimeline.getState().addTextClip(clip)
    useTimeline.getState().selectTextClip(clip.id)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg1)',
        overflowY: 'auto'
      }}
      className="inspector-scroll"
    >
      {/* Header */}
      <div
        style={{
          padding: '12px',
          borderBottom: '0.5px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text2)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase'
          }}
        >
          Text
        </span>
      </div>

      {/* Quick-add button (same as toolbar T button) */}
      <div style={{ padding: '10px 12px' }}>
        <button
          onClick={() => {
            const st = useTimeline.getState()
            const { playheadMs, totalDurationMs } = st
            const durationMs = Math.min(3000, Math.max(500, totalDurationMs - playheadMs))

            const clip = createTextClip({
              text: 'New text',
              startMs: playheadMs,
              durationMs,
              endMs: playheadMs + durationMs,
              // P2.1: manual text takes the first free lane, never silently lane 0.
              trackIndex: laneForManualText(st.textClips),
              style: { ...defaultStyle },
            })

            useTimeline.getState().addTextClip(clip)
            useTimeline.getState().selectTextClip(clip.id)
          }}
          style={{
            width: '100%',
            padding: '8px 0',
            fontSize: '12px',
            fontWeight: 600,
            borderRadius: '5px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'background 0.12s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 85%, #fff)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent)'
          }}
        >
          <Type size={14} />
          + Add Text
        </button>
      </div>

      {/* Style presets — visual previews */}
      <div style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Presets
        </span>
        {TEXT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => handleAddPreset(preset)}
            style={{
              width: '100%',
              borderRadius: '5px',
              background: 'var(--bg2)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
              overflow: 'hidden',
              transition: 'border-color 0.12s, background 0.12s',
              textAlign: 'left',
              padding: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)'
              e.currentTarget.style.background = 'var(--bg3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.background = 'var(--bg2)'
            }}
          >
            {/* Visual text preview */}
            <div style={{
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(30,30,50,0.6), rgba(20,20,40,0.8))',
              borderBottom: '0.5px solid var(--border)',
            }}>
              <span style={{
                fontSize: `${Math.min(preset.fontSize * 0.4, 20)}px`,
                fontWeight: preset.fontWeight,
                color: 'var(--text1)',
                lineHeight: 1,
                letterSpacing: '-0.02em',
              }}>
                {preset.label}
              </span>
            </div>
            {/* Label + description */}
            <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text1)' }}>
                {preset.label}
              </span>
              <span style={{ fontSize: '9px', color: 'var(--text3)' }}>
                {preset.description} · {preset.animation !== 'none' ? preset.animation : 'no anim'}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default TextPanel
