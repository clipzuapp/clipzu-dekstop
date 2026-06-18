import { useMemo, useCallback } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { useCaption } from '../../store/useCaption'
import { formatTime } from '../../utils/format'

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

/**
 * InspectorHeader — persistent section ABOVE the right-rail tab content.
 * Priority: caption entry > text clip > video clip > nothing
 *   - Caption entry: Start/End ms + Text textarea (split-on-enter)
 *   - Text clip:    Start/End ms + Text textarea (simple edit)
 *   - Video clip:   Duration + Name readout
 *   - Nothing:      hidden (ProjectSettings takes over the whole panel)
 */
export function InspectorHeader(): JSX.Element | null {
  const focusedId = useTimeline((s) => s.focusedId)
  const clips = useTimeline((s) => s.clips)
  const textClips = useTimeline((s) => s.textClips)

  const selectedClipId = useMemo(() => {
    if (!focusedId) return null
    return clips.some((c) => c.id === focusedId) ? focusedId : null
  }, [focusedId, clips])

  const selectedTextClipId = useMemo(() => {
    if (!focusedId) return null
    return textClips.some((tc) => tc.id === focusedId) ? focusedId : null
  }, [focusedId, textClips])

  const splitEntryWithText = useCaption((s) => s.splitEntryWithText)
  const setEntryTiming = useCaption((s) => s.setEntryTiming)
  const editEntry = useCaption((s) => s.editEntry)

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null
    return clips.find((c) => c.id === selectedClipId) ?? null
  }, [selectedClipId, clips])

  const selectedTextClip = useMemo(() => {
    if (!selectedTextClipId) return null
    // Lookup from textClips — single source of truth
    return textClips.find((tc) => tc.id === selectedTextClipId) ?? null
  }, [textClips, selectedTextClipId])

  /** Enter splits caption at cursor with proportional timecode; Shift+Enter = newline */
  const handleTextKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const textarea = e.currentTarget
        const cursorPos = textarea.selectionStart
        const fullText = textarea.value
        const beforeText = fullText.slice(0, cursorPos).trim()
        const afterText = fullText.slice(cursorPos).trim()
        if (!beforeText || !afterText) return

        const tc = textClips.find((t) => t.id === selectedTextClipId)
        if (!tc) return

        const totalChars = beforeText.length + afterText.length
        const totalDurationMs = tc.endMs - tc.startMs
        const splitMs = Math.round(
          tc.startMs + (totalDurationMs * beforeText.length) / totalChars
        )

        splitEntryWithText(tc.id, beforeText, afterText, splitMs)
      }
    },
    [textClips, selectedTextClipId, splitEntryWithText]
  )

  // ----- TextClip header -----
  if (selectedTextClip) {
    return (
      <div style={{ borderBottom: '0.5px solid var(--border)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text1)', margin: 0 }}>Text</h3>

        <SectionHeader title="Timing" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '2px' }}>Start (ms)</div>
            <input type="number" value={selectedTextClip.startMs}
              onChange={(e) => setEntryTiming(selectedTextClip.id, parseInt(e.target.value) || 0, selectedTextClip.endMs)}
              style={{
                width: '100%', fontSize: '10px', background: 'var(--bg2)', color: 'var(--text2)',
                border: '0.5px solid var(--border)', borderRadius: '3px', padding: '3px 5px', boxSizing: 'border-box'
              }} />
          </div>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text3)', marginBottom: '2px' }}>End (ms)</div>
            <input type="number" value={selectedTextClip.endMs}
              onChange={(e) => setEntryTiming(selectedTextClip.id, selectedTextClip.startMs, parseInt(e.target.value) || 0)}
              style={{
                width: '100%', fontSize: '10px', background: 'var(--bg2)', color: 'var(--text2)',
                border: '0.5px solid var(--border)', borderRadius: '3px', padding: '3px 5px', boxSizing: 'border-box'
              }} />
          </div>
        </div>

        <SectionHeader title="Text" />
        <textarea value={selectedTextClip.text}
          onChange={(e) => editEntry(selectedTextClip.id, e.target.value)}
          onKeyDown={handleTextKeyDown}
          style={{
            width: '100%', fontSize: '11px', background: 'var(--bg2)', color: 'var(--text2)',
            border: '0.5px solid var(--border)', borderRadius: '3px', padding: '6px',
            resize: 'none', height: '56px', boxSizing: 'border-box', fontFamily: 'inherit'
          }} />
      </div>
    )
  }

  // ----- Text clip header (legacy path — now unified, same as above) -----
  // Kept for backward-compat if selectedTextClip is resolved differently
  // In practice this branch is unreachable since selectedTextClip catches everything
  // ----- Clip header (Duration + Name) -----
  if (selectedClip) {
    return (
      <div style={{ borderBottom: '0.5px solid var(--border)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text1)', margin: 0 }}>Inspector</h3>
        </div>
        <SectionHeader title="Clip" />
        <div style={{ padding: '0 0 4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
            <span style={{ color: 'var(--text3)' }}>Duration</span>
            <span style={{ color: 'var(--text2)', fontFamily: 'monospace' }}>{formatTime(selectedClip.durationMs)}</span>
          </div>
          {selectedClip.name && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
              <span style={{ color: 'var(--text3)' }}>Name</span>
              <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }}>
                {selectedClip.name}
              </span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Nothing selected — ProjectSettings handles the whole panel, no header needed
  return null
}

export default InspectorHeader
