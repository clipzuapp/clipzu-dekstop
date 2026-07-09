// ---------------------------------------------------------------------------
// Effects System — Public API barrel export
// ---------------------------------------------------------------------------

// Types
export type {
  EasingType,
  Keyframe,
  KeyframeTrack,
  KeyframePropertyV1,
  KeyframeProperty,
} from './types/Keyframe'

export { EASING_TYPES, KEYFRAME_PROPERTIES_V1, KEYFRAME_PROPERTIES } from './types/Keyframe'

export type {
  ModifierType,
  ModifierParameterValueType,
  NumberParameterDescriptor,
  StringParameterDescriptor,
  BooleanParameterDescriptor,
  EnumParameterDescriptor,
  ModifierParameterDescriptor,
  ModifierParameterValue,
  Modifier,
  ValidationResult,
  ValidationError,
  ModifierPatch,
} from './types/Modifier'

export { MODIFIER_SCHEMA_VERSION } from './types/Modifier'

export type {
  EffectCategory,
  EffectParameter,
  EffectDefinition,
} from './types/Effect'

export { EFFECT_DEFINITION_VERSION } from './types/Effect'

export type {
  AnimationCategory,
  KeyframeGenerator,
  AnimationDefinition,
} from './types/Animation'

export { ANIMATION_DEFINITION_VERSION } from './types/Animation'

export type {
  TransitionCategory,
  TransitionParameter,
  TransitionDefinition,
} from './types/Transition'

export { TRANSITION_DEFINITION_VERSION } from './types/Transition'

export type {
  PresetSchemaVersion,
  PresetType,
  PresetMetadata,
  EffectPresetData,
  PresetKeyframeEntry,
  PresetKeyframeTrack,
  AnimationPresetData,
  TransitionPresetData,
  PresetData,
  Preset,
  CcpresetFile,
  PresetMigrationFn,
} from './types/Preset'

export { PRESET_SCHEMA_VERSION } from './types/Preset'

// Errors
export {
  EffectErrorCode,
  EffectSystemError,
  DuplicateRegistryError,
  RegistryNotFoundError,
  InvalidModifierError,
  InvalidPresetError,
  SerializationError,
  PresetVersionError,
  ModifierStackError,
} from './errors/EffectErrors'

// Easing
export type { EasingFunction } from './utils/easing'
export { EASING_FUNCTIONS, applyEasing } from './utils/easing'

// Core engines
export { EffectRegistry } from './core/EffectRegistry'
export { PresetRegistry, validatePresetSchema } from './core/PresetRegistry'
export { ModifierEngine, ModifierValidator } from './core/ModifierEngine'
export { TransitionRegistry } from './core/TransitionRegistry'
