import { useCallback } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { useCaption, type CaptionStyle } from '../../store/useCaption'

/**
 * Shared binding between the Inspector UI and the caption style store.
 * Resolves the effective style (per-clip > global) and provides a single
 * `applyStyleToSelected` that writes to both global default and the
 * selected clip's per-clip style — eliminating the dual-write duplication
 * that was copy-pasted across CaptionStyleTab and CaptionAnimationTab.
 */
export function useCaptionStyleBinding(): {
  effectiveStyle: CaptionStyle
  applyStyleToSelected: (partial: Partial<CaptionStyle>) => void
} {
  const activeStyle = useCaption((s) => s.activeStyle)
  const applyStyle = useCaption((s) => s.applyStyle)
  const selectedTextClipId = useTimeline((s) => s.selectedTextClipId)
  const textClips = useTimeline((s) => s.textClips)
  const updateTextClipLive = useTimeline((s) => s.updateTextClipLive)

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

  return { effectiveStyle, applyStyleToSelected }
}
