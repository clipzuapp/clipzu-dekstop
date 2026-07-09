// ---------------------------------------------------------------------------
// KeyframeEvaluator — Pure interpolation, no side effects
// ---------------------------------------------------------------------------
//
// Single evaluation path for keyframe tracks. Used by:
//   - Preview (playback transform override)
//   - Export (ffmpeg filter graph generation)
//   - Timeline (playhead value display)
//
// Wraps the easing functions from effects/utils/easing.ts.
// No other file implements keyframe interpolation.

import type { KeyframeTrack } from '../effects/types/Keyframe'
import { applyEasing } from '../effects/utils/easing'

/**
 * Evaluate a single keyframe track at a given time offset (ms relative to
 * the owning entity's startMs). Returns the interpolated value.
 *
 * - Before first frame: returns first frame's value (hold).
 * - After last frame: returns last frame's value (hold).
 * - Between frames: interpolates using the outgoing frame's easing curve.
 * - Non-numeric values (string, boolean): snap to nearest frame (no interpolation).
 */
export function evaluateKeyframeTrack(
  track: KeyframeTrack,
  localTimeMs: number
): number | string | boolean {
  const { frames } = track
  if (frames.length === 0) return 0

  // Before first keyframe — hold first value
  if (localTimeMs <= frames[0].time) return frames[0].value

  // After last keyframe — hold last value
  const last = frames[frames.length - 1]
  if (localTimeMs >= last.time) return last.value

  // Find the two surrounding frames
  let i = 0
  for (; i < frames.length - 1; i++) {
    if (localTimeMs < frames[i + 1].time) break
  }

  const from = frames[i]
  const to = frames[i + 1]
  const segmentDuration = to.time - from.time
  if (segmentDuration <= 0) return from.value

  const linearT = (localTimeMs - from.time) / segmentDuration
  const easedT = applyEasing(from.easing, linearT)

  // Numeric interpolation
  if (typeof from.value === 'number' && typeof to.value === 'number') {
    return from.value + (to.value - from.value) * easedT
  }

  // Non-numeric: snap at halfway point
  return easedT < 0.5 ? from.value : to.value
}

/**
 * Evaluate multiple keyframe tracks at a given time offset.
 * Returns a record of property → interpolated value.
 * Only numeric values are included (string/boolean tracks are rare for transforms).
 */
export function evaluateKeyframes(
  tracks: KeyframeTrack[] | undefined,
  localTimeMs: number
): Record<string, number> {
  if (!tracks || tracks.length === 0) return {}

  const result: Record<string, number> = {}
  for (const track of tracks) {
    const value = evaluateKeyframeTrack(track, localTimeMs)
    if (typeof value === 'number') {
      result[track.property] = value
    }
  }
  return result
}

/**
 * Get the current value of a specific property from keyframe tracks,
 * with a fallback to a static value when no track exists for that property.
 */
export function getKeyframeValue(
  tracks: KeyframeTrack[] | undefined,
  property: string,
  localTimeMs: number,
  fallback: number
): number {
  if (!tracks) return fallback
  const track = tracks.find((t) => t.property === property)
  if (!track || track.frames.length === 0) return fallback
  const value = evaluateKeyframeTrack(track, localTimeMs)
  return typeof value === 'number' ? value : fallback
}
