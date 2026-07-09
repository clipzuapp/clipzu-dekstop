// ---------------------------------------------------------------------------
// KeyframeEditor — Inspector panel for keyframe management
// ---------------------------------------------------------------------------
//
// Context-sensitive panel shown when a clip/textClip/audioTrack is selected.
// Allows adding/removing keyframes per property, editing values and easing.

import { useState, useCallback, useMemo } from 'react'
import { useTimeline } from '../../store/useTimeline'
import type { KeyframeTrack } from '../../effects/types/Keyframe'
import { EASING_TYPES, type EasingType } from '../../effects/types/Keyframe'
import { KEYFRAME_PROPERTIES_V1 } from '../../effects/types/Keyframe'
import { Diamond, Trash2 } from 'lucide-react'

/** Resolve the selected entity and its keyframe tracks. */
function useSelectedKeyframes(): {
  entityId: string | null
  entityType: 'clip' | 'textClip' | 'audioTrack' | null
  keyframes: KeyframeTrack[]
  playheadMs: number
  entityStartMs: number
  entityDurationMs: number
} {
  const selectedIds = useTimeline((s) => s.selectedIds)
  const clips = useTimeline((s) => s.clips)
  const textClips = useTimeline((s) => s.textClips)
  const audioTracks = useTimeline((s) => s.audioTracks)
  const playheadMs = useTimeline((s) => s.playheadMs)

  return useMemo(() => {
    const id = selectedIds[0]
    if (!id) return { entityId: null, entityType: null, keyframes: [], playheadMs, entityStartMs: 0, entityDurationMs: 0 }

    const clip = clips.find((c) => c.id === id)
    if (clip) return { entityId: id, entityType: 'clip' as const, keyframes: clip.keyframes ?? [], playheadMs, entityStartMs: clip.startMs, entityDurationMs: clip.durationMs }

    const tc = textClips.find((t) => t.id === id)
    if (tc) return { entityId: id, entityType: 'textClip' as const, keyframes: tc.keyframes ?? [], playheadMs, entityStartMs: tc.startMs, entityDurationMs: tc.durationMs }

    const at = audioTracks.find((a) => a.id === id)
    if (at) return { entityId: id, entityType: 'audioTrack' as const, keyframes: at.keyframes ?? [], playheadMs, entityStartMs: at.startMs, entityDurationMs: at.durationMs }

    return { entityId: null, entityType: null, keyframes: [], playheadMs, entityStartMs: 0, entityDurationMs: 0 }
  }, [selectedIds, clips, textClips, audioTracks, playheadMs])
}

export function KeyframeEditor(): JSX.Element {
  const { entityId, entityType, keyframes, entityStartMs } = useSelectedKeyframes()
  const [selectedProperty, setSelectedProperty] = useState<string>(KEYFRAME_PROPERTIES_V1[0] as string)
  const addKeyframeAtPlayhead = useTimeline((s) => s.addKeyframeAtPlayhead)
  const setClipKeyframes = useTimeline((s) => s.setClipKeyframes)
  const setAudioKeyframes = useTimeline((s) => s.setAudioKeyframes)
  const setTextClipKeyframes = useTimeline((s) => s.setTextClipKeyframes)

  const currentTrack = keyframes.find((t) => t.property === selectedProperty)

  const setKeyframes = useCallback(
    (next: KeyframeTrack[]) => {
      if (!entityId) return
      if (entityType === 'clip') setClipKeyframes(entityId, next)
      else if (entityType === 'textClip') setTextClipKeyframes(entityId, next)
      else if (entityType === 'audioTrack') setAudioKeyframes(entityId, next)
    },
    [entityId, entityType, setClipKeyframes, setTextClipKeyframes, setAudioKeyframes]
  )

  const handleAddKeyframe = useCallback(() => {
    if (!entityId) return
    // Default value: use current static value or 0
    addKeyframeAtPlayhead(entityId, selectedProperty, 0)
  }, [entityId, selectedProperty, addKeyframeAtPlayhead])

  const handleRemoveTrack = useCallback(() => {
    if (!entityId) return
    const next = keyframes.filter((t) => t.property !== selectedProperty)
    setKeyframes(next)
  }, [entityId, keyframes, selectedProperty, setKeyframes])

  const handleFrameValueChange = useCallback(
    (frameIndex: number, newValue: number) => {
      if (!currentTrack) return
      const next = keyframes.map((t) => {
        if (t.property !== selectedProperty) return t
        const frames = t.frames.map((f, i) => (i === frameIndex ? { ...f, value: newValue } : f))
        return { ...t, frames }
      })
      setKeyframes(next)
    },
    [currentTrack, keyframes, selectedProperty, setKeyframes]
  )

  const handleFrameEasingChange = useCallback(
    (frameIndex: number, newEasing: EasingType) => {
      if (!currentTrack) return
      const next = keyframes.map((t) => {
        if (t.property !== selectedProperty) return t
        const frames = t.frames.map((f, i) => (i === frameIndex ? { ...f, easing: newEasing } : f))
        return { ...t, frames }
      })
      setKeyframes(next)
    },
    [currentTrack, keyframes, selectedProperty, setKeyframes]
  )

  if (!entityId) {
    return (
      <div className="px-3 py-4 text-center text-[11px] text-gray-500">
        Select a clip to edit keyframes
      </div>
    )
  }

  return (
    <div className="px-3 py-2 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">Keyframes</span>
        <button
          onClick={handleAddKeyframe}
          className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
          title="Add keyframe at playhead"
        >
          <Diamond size={10} />
          <span>Add</span>
        </button>
      </div>

      {/* Property selector */}
      <div className="flex flex-wrap gap-1">
        {KEYFRAME_PROPERTIES_V1.map((prop) => (
          <button
            key={prop}
            onClick={() => setSelectedProperty(prop)}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
              selectedProperty === prop
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {prop}
          </button>
        ))}
      </div>

      {/* Keyframe list for selected property */}
      {currentTrack && currentTrack.frames.length > 0 ? (
        <div className="space-y-1">
          {currentTrack.frames.map((frame, i) => (
            <div key={i} className="flex items-center gap-2 bg-gray-800/50 rounded px-2 py-1">
              <Diamond size={8} className="text-purple-400 flex-shrink-0" />
              <span className="text-[11px] text-gray-400 w-12 flex-shrink-0">
                {((frame.time + entityStartMs) / 1000).toFixed(2)}s
              </span>
              <input
                type="number"
                value={typeof frame.value === 'number' ? frame.value : 0}
                onChange={(e) => handleFrameValueChange(i, Number(e.target.value))}
                className="w-16 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[11px] text-white"
              />
              <select
                value={frame.easing}
                onChange={(e) => handleFrameEasingChange(i, e.target.value as EasingType)}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[11px] text-white"
              >
                {EASING_TYPES.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
          ))}
          <button
            onClick={handleRemoveTrack}
            className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 mt-1"
          >
            <Trash2 size={10} />
            <span>Remove track</span>
          </button>
        </div>
      ) : (
        <div className="text-[11px] text-gray-500 italic">
          No keyframes for "{selectedProperty}". Click Add at playhead.
        </div>
      )}
    </div>
  )
}
