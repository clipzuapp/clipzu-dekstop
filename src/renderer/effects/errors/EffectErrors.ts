// ---------------------------------------------------------------------------
// Effect System Error Hierarchy
// ---------------------------------------------------------------------------

/** Error codes for structured error handling. */
export enum EffectErrorCode {
  DUPLICATE_REGISTRY = 'DUPLICATE_REGISTRY',
  REGISTRY_NOT_FOUND = 'REGISTRY_NOT_FOUND',
  INVALID_MODIFIER = 'INVALID_MODIFIER',
  INVALID_PRESET = 'INVALID_PRESET',
  SERIALIZATION = 'SERIALIZATION',
  PRESET_VERSION = 'PRESET_VERSION',
  MODIFIER_STACK = 'MODIFIER_STACK',
}

/** Base class for all effect system errors. */
export class EffectSystemError extends Error {
  public readonly code: EffectErrorCode

  constructor(code: EffectErrorCode, message: string) {
    super(message)
    this.name = 'EffectSystemError'
    this.code = code
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when attempting to register a duplicate ID. */
export class DuplicateRegistryError extends EffectSystemError {
  public readonly registryName: string
  public readonly conflictingId: string

  constructor(registryName: string, conflictingId: string) {
    super(
      EffectErrorCode.DUPLICATE_REGISTRY,
      `Duplicate registration in ${registryName}: "${conflictingId}" already exists.`
    )
    this.name = 'DuplicateRegistryError'
    this.registryName = registryName
    this.conflictingId = conflictingId
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when a requested ID is not found in a registry. */
export class RegistryNotFoundError extends EffectSystemError {
  public readonly registryName: string
  public readonly missingId: string

  constructor(registryName: string, missingId: string) {
    super(
      EffectErrorCode.REGISTRY_NOT_FOUND,
      `Entry "${missingId}" not found in ${registryName}.`
    )
    this.name = 'RegistryNotFoundError'
    this.registryName = registryName
    this.missingId = missingId
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when modifier validation fails. */
export class InvalidModifierError extends EffectSystemError {
  public readonly field: string

  constructor(field: string, reason: string) {
    super(
      EffectErrorCode.INVALID_MODIFIER,
      `Invalid modifier field "${field}": ${reason}`
    )
    this.name = 'InvalidModifierError'
    this.field = field
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when preset schema validation fails. */
export class InvalidPresetError extends EffectSystemError {
  public readonly field: string

  constructor(field: string, reason: string) {
    super(
      EffectErrorCode.INVALID_PRESET,
      `Invalid preset field "${field}": ${reason}`
    )
    this.name = 'InvalidPresetError'
    this.field = field
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown on serialization or deserialization failure. */
export class SerializationError extends EffectSystemError {
  public readonly operation: 'serialize' | 'deserialize'

  constructor(operation: 'serialize' | 'deserialize', reason: string) {
    super(
      EffectErrorCode.SERIALIZATION,
      `Serialization ${operation} failed: ${reason}`
    )
    this.name = 'SerializationError'
    this.operation = operation
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when an unsupported preset schema version is encountered. */
export class PresetVersionError extends EffectSystemError {
  public readonly unsupportedVersion: number
  public readonly maxSupportedVersion: number

  constructor(unsupportedVersion: number, maxSupportedVersion: number) {
    super(
      EffectErrorCode.PRESET_VERSION,
      `Unsupported preset version ${unsupportedVersion}. Maximum supported: ${maxSupportedVersion}.`
    )
    this.name = 'PresetVersionError'
    this.unsupportedVersion = unsupportedVersion
    this.maxSupportedVersion = maxSupportedVersion
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown on invalid modifier stack operations (reorder out of bounds, etc.). */
export class ModifierStackError extends EffectSystemError {
  constructor(reason: string) {
    super(EffectErrorCode.MODIFIER_STACK, reason)
    this.name = 'ModifierStackError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
