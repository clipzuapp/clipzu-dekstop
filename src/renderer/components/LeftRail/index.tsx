import type { FC } from 'react'
import {
  FolderOpen, LayoutTemplate, Sparkles, Music, Type,
  Captions, FileText, Wand2, ArrowLeftRight, SlidersHorizontal, Puzzle
} from 'lucide-react'

export type LeftTabId =
  | 'media' | 'templates' | 'elements' | 'audio'
  | 'text' | 'captions' | 'transcript' | 'effects'
  | 'transitions' | 'filters' | 'plugins'

interface TabDef {
  id: LeftTabId
  label: string
  Icon: FC<{ size?: number | string }>
}

export const LEFT_TABS: TabDef[] = [
  { id: 'media',        label: 'Media',        Icon: FolderOpen },
  { id: 'templates',    label: 'Templates',    Icon: LayoutTemplate },
  { id: 'elements',     label: 'Elements',     Icon: Sparkles },
  { id: 'audio',        label: 'Audio',        Icon: Music },
  { id: 'text',         label: 'Text',         Icon: Type },
  { id: 'captions',     label: 'Captions',     Icon: Captions },
  { id: 'transcript',   label: 'Transcript',   Icon: FileText },
  { id: 'effects',      label: 'Effects',      Icon: Wand2 },
  { id: 'transitions',  label: 'Transitions',  Icon: ArrowLeftRight },
  { id: 'filters',      label: 'Filters',      Icon: SlidersHorizontal },
  { id: 'plugins',      label: 'Plugins',      Icon: Puzzle }
]

interface Props {
  activeTab: LeftTabId
  onSelect: (tab: LeftTabId) => void
}

/**
 * LeftRail — vertical icon rail (~64px wide), fixed width.
 * Each item: icon stacked above a small label, both centered.
 * Active tab highlighted with --accent background tint.
 */
export function LeftRail({ activeTab, onSelect }: Props): JSX.Element {
  return (
    <div
      style={{
        width: '64px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--bg1)',
        borderRight: '0.5px solid var(--border)',
        overflowY: 'auto',
        paddingTop: '8px',
        paddingBottom: '8px',
        gap: '2px',
        userSelect: 'none'
      }}
    >
      {LEFT_TABS.map((tab) => {
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

export default LeftRail
