// ---------------------------------------------------------------------------
// Effect Definition Types
// ---------------------------------------------------------------------------

import type { ModifierParameterDescriptor } from './Modifier'

/** Known effect categories. Extensible via string. */
export type EffectCategory =
  | 'blur'
  | 'glow'
  | 'camera'
  | 'color'
  | 'distortion'
  | 'style'
  | 'noise'
  | 'utility'
  | (string & {})

/** Schema version for effect definitions. */
export const EFFECT_DEFINITION_VERSION = 1

/** Descriptor for a single effect parameter exposed to the user. */
export interface EffectParameter {
  /** Internal parameter name (used as key in Modifier.parameters). */
  name: string

  /** Human-readable label. */
  displayName: string

  /** Typed parameter descriptor (number, string, boolean, enum). */
  descriptor: ModifierParameterDescriptor
}

/** A registered effect definition. Immutable after registration. */
export interface EffectDefinition {
  /** Unique effect identifier. */
  id: string

  /** Category for grouping in UI browsers. */
  category: EffectCategory

  /** Human-readable display name. */
  displayName: string

  /** Ordered parameter descriptors. */
  parameters: EffectParameter[]

  /** Schema version. */
  version: number
}
