// ---------------------------------------------------------------------------
// Modifier Domain Types
// ---------------------------------------------------------------------------

import type { KeyframeTrack } from './Keyframe'

/** The three modifier categories. */
export type ModifierType = 'effect' | 'animation' | 'transition'

// ---------------------------------------------------------------------------
// Parameter value types
// ---------------------------------------------------------------------------

/** Concrete parameter value types supported by modifiers. */
export type ModifierParameterValueType = 'number' | 'string' | 'boolean' | 'enum'

/** Descriptor for a number-typed parameter. */
export interface NumberParameterDescriptor {
  valueType: 'number'
  default: number
  min: number
  max: number
  step: number
}

/** Descriptor for a string-typed parameter. */
export interface StringParameterDescriptor {
  valueType: 'string'
  default: string
  maxLength?: number
}

/** Descriptor for a boolean-typed parameter. */
export interface BooleanParameterDescriptor {
  valueType: 'boolean'
  default: boolean
}

/** Descriptor for an enum-typed parameter (fixed set of string options). */
export interface EnumParameterDescriptor {
  valueType: 'enum'
  default: string
  options: readonly string[]
}

/** Union of all parameter descriptors. Discriminated by `valueType`. */
export type ModifierParameterDescriptor =
  | NumberParameterDescriptor
  | StringParameterDescriptor
  | BooleanParameterDescriptor
  | EnumParameterDescriptor

/** Runtime parameter value — strongly typed per variant. */
export type ModifierParameterValue = number | string | boolean

// ---------------------------------------------------------------------------
// Modifier
// ---------------------------------------------------------------------------

/** Schema version for modifier serialization. Bumped on breaking changes. */
export const MODIFIER_SCHEMA_VERSION = 1

/** A single modifier attached to a timeline entity. */
export interface Modifier {
  /** Unique identifier for this modifier instance. */
  id: string

  /** Category of this modifier. */
  type: ModifierType

  /** Reference to a registered preset (effect, animation, or transition ID). */
  presetId: string

  /** Whether this modifier is active in the processing stack. */
  enabled: boolean

  /** Parameter overrides keyed by parameter name. */
  parameters: Record<string, ModifierParameterValue>

  /** Keyframe tracks for animated properties. */
  keyframes: KeyframeTrack[]

  /** Schema version for forward-compatible serialization. */
  version: number
}

/** Result of a validation operation. */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/** A single validation error. */
export interface ValidationError {
  field: string
  message: string
}

/** Patch object for partial modifier updates. */
export type ModifierPatch = Partial<
  Pick<Modifier, 'enabled' | 'parameters' | 'keyframes'>
>
