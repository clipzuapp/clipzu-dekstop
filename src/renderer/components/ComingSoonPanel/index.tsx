import type { ReactNode } from 'react'

interface Props {
  label: string
  icon?: ReactNode
}

/**
 * Lightweight placeholder panel for future features.
 * Reuses --text3 / --bg2 tokens from the design system.
 */
export function ComingSoonPanel({ label, icon }: Props): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '12px',
        color: 'var(--text3)',
        background: 'var(--bg1)',
        padding: '24px'
      }}
    >
      {icon && (
        <div style={{ opacity: 0.25, width: '40px', height: '40px' }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text3)' }}>
        {label} coming soon
      </div>
    </div>
  )
}

export default ComingSoonPanel
