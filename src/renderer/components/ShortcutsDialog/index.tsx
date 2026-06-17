import { useEffect, useCallback } from 'react'

interface ShortcutRow {
  key: string
  action: string
}

const GENERAL_SHORTCUTS: ShortcutRow[] = [
  { key: 'Space', action: 'Play / Pause' },
  { key: 'J', action: 'Rewind 5 seconds' },
  { key: 'K', action: 'Pause' },
  { key: 'L', action: 'Forward 5 seconds' },
  { key: 'Arrow Left / Right', action: 'Step one frame backward / forward' },
  { key: 'Shift + Arrow Left / Right', action: 'Step 1 second backward / forward' },
  { key: 'Home / End', action: 'Jump to start / end of timeline' },
  { key: 'S', action: 'Split clip at playhead' },
  { key: 'Delete / Backspace', action: 'Delete selected clips (immediate)' },
  { key: 'I', action: 'Set in point (trim start)' },
  { key: 'O', action: 'Set out point (trim end)' },
  { key: 'T', action: 'Add text clip' },
  { key: '?', action: 'Show keyboard shortcuts' }
]

const EDITING_SHORTCUTS: ShortcutRow[] = [
  { key: 'Ctrl + Z', action: 'Undo' },
  { key: 'Ctrl + Shift + Z / Ctrl + Y', action: 'Redo' },
  { key: 'Ctrl + C', action: 'Copy selection' },
  { key: 'Ctrl + X', action: 'Cut selection' },
  { key: 'Ctrl + V', action: 'Paste at playhead' },
  { key: 'Ctrl + D', action: 'Duplicate selection' },
  { key: 'Ctrl + A', action: 'Select all clips' },
  { key: 'Ctrl + S', action: 'Save project' },
  { key: 'Ctrl + O', action: 'Open project' },
  { key: 'Ctrl + E', action: 'Export' }
]

const TOOL_SHORTCUTS: ShortcutRow[] = [
  { key: 'V', action: 'Select tool — select & move' },
  { key: 'B', action: 'Blade tool — click to split' },
  { key: 'H', action: 'Hand tool — click & drag to pan' },
  { key: 'Z', action: 'Zoom tool — click to zoom in, Alt+click to zoom out' }
]

const TIMELINE_SHORTCUTS: ShortcutRow[] = [
  { key: 'Ctrl + Scroll', action: 'Zoom timeline (zoom-to-cursor)' },
  { key: 'Drag clip edge', action: 'Trim clip start/end' },
  { key: 'Drag clip body', action: 'Move clip on timeline' },
  { key: 'Shift + Click', action: 'Range select clips' },
  { key: 'Ctrl + Click', action: 'Toggle clip in selection' },
  { key: 'Drag audio block', action: 'Move audio on timeline' },
  { key: 'Drag caption body', action: 'Move caption on timeline' },
  { key: 'Double-click caption', action: 'Edit caption text' },
  { key: 'Right-click → Ripple Delete', action: 'Delete clip and close gap' }
]

function Section({ title, rows }: { title: string; rows: ShortcutRow[] }): JSX.Element {
  return (
    <div style={{ marginBottom: '16px' }}>
      <h4 style={{
        fontSize: '10px', fontWeight: 600, color: 'var(--text3)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        margin: '0 0 8px', paddingBottom: '4px',
        borderBottom: '0.5px solid var(--border)'
      }}>
        {title}
      </h4>
      {rows.map((row) => (
        <div key={row.key} style={{
          display: 'flex', justifyContent: 'space-between',
          padding: '3px 0', fontSize: '12px'
        }}>
          <kbd style={{
            fontFamily: 'var(--font-mono)', fontSize: '11px',
            background: 'var(--bg3)', color: 'var(--text1)',
            padding: '1px 6px', borderRadius: '3px',
            border: '0.5px solid var(--border)',
            minWidth: '100px', textAlign: 'center'
          }}>
            {row.key}
          </kbd>
          <span style={{ color: 'var(--text2)', flex: 1, marginLeft: '16px' }}>
            {row.action}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg1)', border: '0.5px solid var(--border)',
          borderRadius: '8px', padding: '20px 24px',
          width: '480px', maxHeight: '80vh', overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '16px'
        }}>
          <h3 style={{
            fontSize: '14px', fontWeight: 600, color: 'var(--text1)', margin: 0
          }}>
            Keyboard Shortcuts
          </h3>
          <button
            style={{
              fontSize: '18px', color: 'var(--text3)', background: 'none',
              border: 'none', cursor: 'pointer', padding: '0 4px'
            }}
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        <Section title="Playback" rows={GENERAL_SHORTCUTS} />
        <Section title="Editing" rows={EDITING_SHORTCUTS} />
        <Section title="Tools" rows={TOOL_SHORTCUTS} />
        <Section title="Timeline" rows={TIMELINE_SHORTCUTS} />
      </div>
    </div>
  )
}

export default ShortcutsDialog
