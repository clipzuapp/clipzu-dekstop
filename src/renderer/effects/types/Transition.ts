// ---------------------------------------------------------------------------
// Transition Definition Types
// ---------------------------------------------------------------------------

import type { ModifierParameterDescriptor } from './Modifier'

/** Known transition categories. Extensible via string. */
export type TransitionCategory =
  | 'dissolve'
  | 'slide'
  | 'wipe'
  | 'zoom'
  | 'blur'
  | 'light'
  | (string & {})

/** Schema version for transition definitions. */
export const TRANSITION_DEFINITION_VERSION = 1

/** Descriptor for a single transition parameter. */
export interface TransitionParameter {
  /** Internal parameter name. */
  name: string

  /** Human-readable label. */
  displayName: string

  /** Typed parameter descriptor. */
  descriptor: ModifierParameterDescriptor
}

/** A registered transition definition. */
export interface TransitionDefinition {
  /** Unique transition identifier. */
  id: string

  /** Human-readable display name. */
  displayName: string

  /** Category for grouping. */
  category: TransitionCategory

  /** Default duration in milliseconds. */
  defaultDurationMs: number

  /** Configurable parameters. */
  parameters: TransitionParameter[]

  /** Schema version. */
  version: number
}
