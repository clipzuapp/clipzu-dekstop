import type { FC } from 'react'
import {
  Sliders, Image, Wand2, Volume2, Sparkles, Gauge
} from 'lucide-react'

export type RightTabId =
  | 'basic' | 'background' | 'smart-tools'
  | 'audio' | 'animation' | 'speed'

interface TabDef {
  id: RightTabId
  label: string
  Icon: FC<{ size?: number | string }>
}

export const RIGHT_TABS: TabDef[] = [
  { id: 'basic',        label: 'Basic',        Icon: Sliders },
  { id: 'background',   label: 'Background',   Icon: Image },
  { id: 'smart-tools',  label: 'Smart Tools',  Icon: Wand2 },
  { id: 'audio',        label: 'Audio',        Icon: Volume2 },
  { id: 'animation',    label: 'Animation',    Icon: Sparkles },
  { id: 'speed',        label: 'Speed',        Icon: Gauge }
]

interface Props {
  activeTab: RightTabId
  onSelect: (tab: RightTabId) => void
}

/**
 * RightRail — vertical icon rail (~64px) on the far right edge.
 * Mirrors LeftRail layout: icon stacked above small label, centered.
 * Inspector panel sits between Preview and this rail.
 */
export function RightRail({ activeTab, onSelect }: Props): JSX.Element {
  return (
    <div
      style={{
        width: '64px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--bg1)',
        borderLeft: '0.5px solid var(--border)',
        overflowY: 'auto',
        paddingTop: '8px',
        paddingBottom: '8px',
        gap: '2px',
        userSelect: 'none'
      }}
    >
      {RIGHT_TABS.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            title={tab.label}
            aria-label={tab.label}
            aria-pressed={isActive}
            style={{
              width: '52px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              padding: '6px 4px',
              borderRadius: '6px',
              border: 'none',
              background: isActive ? 'rgba(79, 127, 255, 0.15)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--text3)',
              cursor: 'pointer',
              transition: 'all 0.12s'
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'var(--bg3)'
                e.currentTarget.style.color = 'var(--text2)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--text3)'
              }
            }}
          >
            <tab.Icon size={20} />
            <span style={{ fontSize: '10px', fontWeight: 400, lineHeight: '1.1' }}>
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default RightRail
