// ---------------------------------------------------------------------------
// Preset & .ccpreset File Format Types
// ---------------------------------------------------------------------------

import type { ModifierParameterValue } from './Modifier'
import type { Keyframe } from './Keyframe'

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

/** Current preset schema version. Bumped on breaking changes. */
export const PRESET_SCHEMA_VERSION = 1 as const

/** Literal type for the current supported version. */
export type PresetSchemaVersion = typeof PRESET_SCHEMA_VERSION

/** Discriminated preset types. */
export type PresetType = 'effect' | 'animation' | 'transition'

// ---------------------------------------------------------------------------
// Preset metadata
// ---------------------------------------------------------------------------

/** Metadata shared by all preset variants. */
export interface PresetMetadata {
  /** Schema version. */
  version: PresetSchemaVersion

  /** Preset category. */
  type: PresetType

  /** Human-readable preset name. */
  name: string

  /** Author or source. */
  author: string

  /** Category for grouping in browsers. */
  category: string

  /** Optional description. */
  description?: string

  /** Optional tags for search/marketplace. */
  tags?: readonly string[]
}

// ---------------------------------------------------------------------------
// Preset data variants
// ---------------------------------------------------------------------------

/** Effect preset payload. */
export interface EffectPresetData {
  type: 'effect'

  /** Parameter overrides keyed by parameter name. */
  parameters: Record<string, ModifierParameterValue>
}

/** Keyframe entry in an animation preset (serialized form). */
export interface PresetKeyframeEntry {
  time: number
  value: number | string | boolean
  easing: string
}

/** Keyframe track in an animation preset (serialized form). */
export interface PresetKeyframeTrack {
  property: string
  frames: PresetKeyframeEntry[]
}

/** Animation preset payload. */
export interface AnimationPresetData {
  type: 'animation'

  /** Duration in milliseconds. */
  duration: number

  /** Keyframe tracks defining the animation curve. */
  keyframes: PresetKeyframeTrack[]
}

/** Transition preset payload. */
export interface TransitionPresetData {
  type: 'transition'

  /** Duration in milliseconds. */
  duration: number

  /** Parameter overrides. */
  parameters: Record<string, ModifierParameterValue>
}

/** Union of all preset data variants. Discriminated by `type`. */
export type PresetData = EffectPresetData | AnimationPresetData | TransitionPresetData

// ---------------------------------------------------------------------------
// Preset (internal representation)
// ---------------------------------------------------------------------------

/** Internal preset representation used by the PresetRegistry. */
export interface Preset {
  /** Unique preset identifier (derived from metadata.name slug or explicit ID). */
  id: string

  /** Preset metadata. */
  metadata: PresetMetadata

  /** Preset data payload. */
  data: PresetData
}

// ---------------------------------------------------------------------------
// .ccpreset file schema
// ---------------------------------------------------------------------------

/**
 * Top-level `.ccpreset` file structure.
 * This is the on-disk / marketplace exchange format.
 */
export interface CcpresetFile {
  /** Schema version. */
  version: PresetSchemaVersion

  /** Preset category. */
  type: PresetType

  /** Human-readable name. */
  name: string

  /** Author. */
  author: string

  /** Category. */
  category: string

  /** Optional description. */
  description?: string

  /** Optional tags. */
  tags?: string[]

  // -- Variant-specific fields (flattened for JSON readability) --

  /** Effect/transition parameters. */
  parameters?: Record<string, ModifierParameterValue>

  /** Animation duration (ms) or transition duration (ms). */
  duration?: number

  /** Animation keyframes. */
  keyframes?: PresetKeyframeTrack[]
}

// ---------------------------------------------------------------------------
// Migration support
// ---------------------------------------------------------------------------

/** Migration function signature: transforms older schema to newer. */
export type PresetMigrationFn = (data: Record<string, unknown>) => Record<string, unknown>

/** Keyframe runtime type (used internally, not serialized). */
export type { Keyframe }
