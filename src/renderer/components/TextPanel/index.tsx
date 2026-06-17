import { useTimeline } from '../../store/useTimeline'
import { Type } from 'lucide-react'

interface TextPreset {
  label: string
  fontSize: number
  fontWeight: number
  animation: string
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
      text: preset.label,
      style: {
        fontFamily: 'Inter',
        fontSize: preset.fontSize,
        fontWeight: preset.fontWeight,
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
        animation: preset.animation as any,
        captionMode: 'full-phrase'
      }
    })

    useTimeline.getState().selectTextClip(newId)
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
            // Reuse handleAddText logic inline
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
                animation: 'pop',
                captionMode: 'full-phrase'
              }
            })
            useTimeline.getState().selectTextClip(newId)
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

      {/* Style presets */}
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
              padding: '10px 12px',
              borderRadius: '5px',
              background: 'var(--bg2)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
              transition: 'border-color 0.12s, background 0.12s',
              textAlign: 'left'
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
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text1)' }}>
              {preset.label}
            </span>
            <span style={{ fontSize: '9px', color: 'var(--text3)' }}>
              {preset.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default TextPanel
