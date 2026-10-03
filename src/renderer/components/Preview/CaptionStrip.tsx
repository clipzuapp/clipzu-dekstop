import { useRef, useEffect, useState, useMemo } from 'react'
import { useCaption } from '../../store/useCaption'
import { useTimeline, getStyleClipboard } from '../../store/useTimeline'
import { useConfirm } from '../../store/useConfirm'
import { useToast } from '../../store/useToast'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/index'
import { resolveActiveCaptions } from '../../../shared/captions/lanes'

const LANGUAGES = [
  { value: 'auto', label: 'Auto' },
  { value: 'en', label: 'EN' },
  { value: 'id', label: 'ID' },
  { value: 'zh', label: 'ZH' },
  { value: 'ja', label: 'JA' },
  { value: 'ko', label: 'KO' },
  { value: 'es', label: 'ES' },
  { value: 'fr', label: 'FR' },
  { value: 'de', label: 'DE' },
]

async function handleTranscribe(language: string): Promise<void> {
  const state = useTimeline.getState()
  const clips = state.clips
  if (clips.length === 0) {
    useToast.getState().warning('Add a video clip to the timeline first.')
    return
  }
  const targetId = (state.focusedId && clips.some((c) => c.id === state.focusedId))
    ? state.focusedId
    : clips[0].id
  try {
    await useCaption.getState().transcribeClip(targetId, language)
  } catch (e) {
    console.error('Transcription failed:', e)
    useToast.getState().error(`Transcription failed: ${(e as Error).message}`)
  }
}

/**
 * CaptionStrip — horizontal scrolling pills, auto-scroll to active caption
 * Height: 32px, background var(--bg1), border-top 0.5px solid var(--border)
 */
export function CaptionStrip(): JSX.Element {
  const entries = useTimeline((s) => s.textClips)
  const focusedId = useTimeline((s) => s.focusedId)
  const textClips = useTimeline((s) => s.textClips)
  const status = useCaption((s) => s.status)
  const progress = useCaption((s) => s.progress)
  const selectedId = useMemo(() => {
    if (!focusedId) return null
    return textClips.some((tc) => tc.id === focusedId) ? focusedId : null
  }, [focusedId, textClips])
  const selectEntry = useCaption((s) => s.selectEntry)

  const playheadMs = useTimeline((s) => s.playheadMs)

  const containerRef = useRef<HTMLDivElement>(null)
  const activePillRef = useRef<HTMLDivElement>(null)
  const [language, setLanguage] = useState('auto')

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  // Active entries across ALL caption lanes (P2.3 stacking parity with Preview).
  const activeEntries = resolveActiveCaptions(entries, playheadMs)
  const activeEntryIds = new Set(activeEntries.map((e) => e.id))
  const activeEntryId = activeEntries.length > 0 ? activeEntries[0].id : selectedId

  // Auto-scroll active pill into view
  useEffect(() => {
    if (activePillRef.current && activeEntryId) {
      activePillRef.current.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest'
      })
    }
  }, [activeEntryId])

  return (
    <div
      style={{
        height: '32px',
        background: 'var(--bg1)',
        borderTop: '0.5px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 8px',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0
      }}
      ref={containerRef}
    >
      {/* Left label */}
      <span
        style={{
          fontSize: '9px',
          color: 'var(--text3)',
          flexShrink: 0,
          marginRight: '4px'
        }}
      >
        Captions:
      </span>

      {/* Transcribing state — show progress bar */}
      {status === 'transcribing' ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <div
            style={{
              flex: 1,
              height: '2px',
              background: 'var(--bg4)',
              borderRadius: '1px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: 'var(--amber)',
                transition: 'width 0.2s'
              }}
            />
          </div>
          <span style={{ fontSize: '9px', color: 'var(--amber)', flexShrink: 0 }}>
            Transcribing… {Math.round(progress)}%
          </span>
        </div>
      ) : entries.length === 0 ? (
        /* Empty state — Transcribe button + language selector */
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>No captions —</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={{
              fontSize: '10px', background: 'var(--bg2)', color: 'var(--text2)',
              border: '0.5px solid var(--border)', borderRadius: '3px', padding: '2px 4px',
              cursor: 'pointer'
            }}>
            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button
            onClick={() => handleTranscribe(language)}
            style={{
              padding: '3px 10px', background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: '4px', fontSize: '10px',
              cursor: 'pointer', fontWeight: 500
            }}>
            Transcribe
          </button>
        </div>
      ) : (
        /* Caption pills */
        entries.map((entry) => {
          const isActive = activeEntryIds.has(entry.id)

          return (
            <div
              key={entry.id}
              ref={isActive ? activePillRef : null}
              onContextMenu={(e) => {
                e.preventDefault()
                const ph = useTimeline.getState().playheadMs
                setCtxMenu({
                  x: e.clientX, y: e.clientY,
                  items: [
                    { label: 'Edit Text', onClick: () => {
                      selectEntry(entry.id)
                      useTimeline.getState().setPlayhead(entry.startMs)
                    }},
                    { divider: true },
                    { label: 'Copy Style', onClick: () => { useTimeline.getState().copyStyle() } },
                    { label: 'Paste Style', disabled: !getStyleClipboard(), onClick: () => { useTimeline.getState().pasteStyle() } },
                    { divider: true },
                    { label: 'Duplicate', onClick: () => useCaption.getState().duplicateEntry(entry.id) },
                    { label: 'Split at Playhead', disabled: !(ph > entry.startMs && ph < entry.endMs), onClick: () => {
                      useCaption.getState().splitEntry(entry.id, ph)
                    }},
                    { divider: true },
                    { label: 'Delete', danger: true, onClick: () => {
                      useConfirm.getState().show({
                        title: 'Delete Caption',
                        message: `Delete caption "${entry.text.slice(0, 40)}${entry.text.length > 40 ? '\u2026' : ''}"?`,
                        variant: 'danger',
                        confirmLabel: 'Delete'
                      }).then((c) => { if (c) useCaption.getState().deleteEntry(entry.id) })
                    }}
                  ]
                })
              }}
              onClick={() => {
                selectEntry(entry.id)
                useTimeline.getState().setPlayhead(entry.startMs)
              }}
              style={{
                padding: '3px 8px',
                borderRadius: '3px',
                fontSize: '10px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                flexShrink: 0,
                border: isActive
                  ? '0.5px solid rgba(79, 127, 255, 0.5)'
                  : '0.5px solid var(--border)',
                color: isActive ? '#7da6ff' : 'var(--text2)',
                background: isActive ? 'rgba(79, 127, 255, 0.2)' : 'var(--bg2)',
                transition: 'all 0.1s'
              }}
            >
              {entry.text}
            </div>
          )
        })
      )}

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          items={ctxMenu.items}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}

export default CaptionStrip
