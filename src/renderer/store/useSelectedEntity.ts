import { useMemo } from 'react'
import { useTimeline, type TimelineState } from './useTimeline'

export interface SelectedEntity {
  /** ID of the selected video clip, or null if none selected or a different entity type is selected */
  selectedClipId: string | null
  /** ID of the selected text/caption clip, or null */
  selectedTextClipId: string | null
  /** ID of the selected audio track, or null */
  selectedAudioTrackId: string | null
}

/**
 * Derives which entity type is currently selected from the unified focusedId.
 * Single source of truth — replaces duplicate useMemo blocks in Preview,
 * Inspector, and useCaptionStyleBinding.
 */
export function useSelectedEntity(): SelectedEntity {
  const focusedId = useTimeline((s: TimelineState) => s.focusedId)
  const clips = useTimeline((s: TimelineState) => s.clips)
  const textClips = useTimeline((s: TimelineState) => s.textClips)
  const audioTracks = useTimeline((s: TimelineState) => s.audioTracks)

  return useMemo<SelectedEntity>(() => {
    if (!focusedId) {
      return { selectedClipId: null, selectedTextClipId: null, selectedAudioTrackId: null }
    }
    return {
      selectedClipId: clips.some((c) => c.id === focusedId) ? focusedId : null,
      selectedTextClipId: textClips.some((tc) => tc.id === focusedId) ? focusedId : null,
      selectedAudioTrackId: audioTracks.some((a) => a.id === focusedId) ? focusedId : null,
    }
  }, [focusedId, clips, textClips, audioTracks])
}

export default useSelectedEntity
