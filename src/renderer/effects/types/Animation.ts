// ---------------------------------------------------------------------------
// Animation Definition Types
// ---------------------------------------------------------------------------

import type { KeyframeTrack } from './Keyframe'

/** Known animation categories. Extensible via string. */
export type AnimationCategory =
  | 'entrance'
  | 'exit'
  | 'emphasis'
  | 'text'
  | 'motion'
  | (string & {})

/** Schema version for animation definitions. */
export const ANIMATION_DEFINITION_VERSION = 1

/**
 * Generates keyframe tracks for a given duration.
 * Animations are data generators — they produce keyframes, not render output.
 */
export type KeyframeGenerator = (durationMs: number) => KeyframeTrack[]

/** A registered animation definition. */
export interface AnimationDefinition {
  /** Unique animation identifier. */
  id: string

  /** Human-readable display name. */
  displayName: string

  /** Category for grouping. */
  category: AnimationCategory

  /** Default duration in milliseconds. */
  defaultDurationMs: number

  /** Keyframe template generator. Pure function producing KeyframeTrack[]. */
  generateKeyframes: KeyframeGenerator

  /** Schema version. */
  version: number
}
