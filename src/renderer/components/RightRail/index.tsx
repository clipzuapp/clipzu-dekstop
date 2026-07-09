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
      className="rail-scroll"
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
            className="rail-btn"
          >
            <tab.Icon size={20} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default RightRail
