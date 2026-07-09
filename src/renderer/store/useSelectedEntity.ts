import { useMemo } from 'react'
import { useTimeline } from './useTimeline'

export interface SelectedEntity {
  /** ID of the selected video clip, or null if none selected or a different entity type is selected */
  selectedClipId: string | null
  /** ID of the selected text/caption clip, or null */
  selectedTextClipId: string | null
  /** ID of the selected audio track, or null */
  selectedAudioTrackId: string | null
}

const EMPTY: SelectedEntity = {
  selectedClipId: null,
  selectedTextClipId: null,
  selectedAudioTrackId: null,
}

/**
 * Derives which entity type is currently selected from the unified focusedId.
 *
 * Performance: subscribes to a single primitive string (`"focusedId:exists"`).
 * This avoids subscribing to the full clips/textClips/audioTracks arrays
 * (which would re-render on every mutation).
 *
 * Single source of truth — used by Preview, Inspector, and useCaptionStyleBinding.
 */
export function useSelectedEntity(): SelectedEntity {
  // Returns a primitive string that only changes when focusedId or its existence changes.
  // Format: "id:1" (exists) or "id:0" (not found) or ":" (no focus)
  const key = useTimeline((s) => {
    const fid = s.focusedId
    if (!fid) return ':'
    const inClips = s.clips.some((c) => c.id === fid)
    const inText = inClips ? false : s.textClips.some((tc) => tc.id === fid)
    const inAudio = inClips || inText ? false : s.audioTracks.some((a) => a.id === fid)
    return `${fid}:${inClips || inText || inAudio ? 1 : 0}`
  })

  return useMemo<SelectedEntity>(() => {
    const sepIdx = key.lastIndexOf(':')
    const fid = key.slice(0, sepIdx)
    const exists = key.slice(sepIdx + 1) === '1'
    if (!fid || !exists) return EMPTY

    // Determine which array contains focusedId using getState() (no subscription)
    const state = useTimeline.getState()
    const inClips = state.clips.some((c) => c.id === fid)
    const inText = inClips ? false : state.textClips.some((tc) => tc.id === fid)
    return {
      selectedClipId: inClips ? fid : null,
      selectedTextClipId: inText ? fid : null,
      selectedAudioTrackId: inClips || inText ? null : fid,
    }
  }, [key])
}

export default useSelectedEntity
