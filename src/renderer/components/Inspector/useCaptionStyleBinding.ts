import { useCallback, useMemo } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { useCaption, type CaptionStyle } from '../../store/useCaption'

/**
 * Shared binding between the Inspector UI and the caption style store.
 * Resolves the effective style (per-clip > global) and provides:
 * - `applyStyleToSelected` — writes to global default + selected clip's per-clip style
 * - `applyStyleToAllOnLayer` — propagates the current effective style to ALL
 *   text clips on the same trackIndex (layer) as the selected caption
 */
export function useCaptionStyleBinding(): {
  effectiveStyle: CaptionStyle
  applyStyleToSelected: (partial: Partial<CaptionStyle>) => void
  applyStyleToAllOnLayer: () => void
} {
  const activeStyle = useCaption((s) => s.activeStyle)
  const applyStyle = useCaption((s) => s.applyStyle)
  const focusedId = useTimeline((s) => s.focusedId)
  const textClips = useTimeline((s) => s.textClips)
  const updateTextClipLive = useTimeline((s) => s.updateTextClipLive)

  const selectedTextClipId = useMemo(() => {
    if (!focusedId) return null
    return textClips.some((tc) => tc.id === focusedId) ? focusedId : null
  }, [focusedId, textClips])

  const selectedTextClip = selectedTextClipId
    ? textClips.find((tc) => tc.id === selectedTextClipId) ?? null
    : null
  const effectiveStyle = selectedTextClip?.style ?? activeStyle

  const applyStyleToSelected = useCallback(
    (partial: Partial<CaptionStyle>) => {
      applyStyle(partial)
      if (selectedTextClipId) {
        const baseStyle = selectedTextClip?.style ?? activeStyle
        updateTextClipLive(selectedTextClipId, {
          style: { ...baseStyle, ...partial }
        })
      }
    },
    [applyStyle, selectedTextClipId, selectedTextClip, activeStyle, updateTextClipLive]
  )

  const applyStyleToAllOnLayer = useCallback(() => {
    if (!selectedTextClip) return
    const targetTrack = selectedTextClip.trackIndex
    const fullStyle = { ...(selectedTextClip.style ?? activeStyle) }
    for (const tc of textClips) {
      if (tc.trackIndex === targetTrack) {
        updateTextClipLive(tc.id, { style: { ...fullStyle } })
      }
    }
    applyStyle(fullStyle)
  }, [selectedTextClip, activeStyle, textClips, updateTextClipLive, applyStyle])

  return { effectiveStyle, applyStyleToSelected, applyStyleToAllOnLayer }
}
