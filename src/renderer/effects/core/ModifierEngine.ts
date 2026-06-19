// ---------------------------------------------------------------------------
// Modifier Engine & Validator — Pure logic, no side effects
// ---------------------------------------------------------------------------

import type {
  Modifier,
  ModifierPatch,
  ModifierParameterValue,
  ValidationResult,
  ValidationError,
} from '../types/Modifier'
import { MODIFIER_SCHEMA_VERSION } from '../types/Modifier'
import type { KeyframeTrack, Keyframe } from '../types/Keyframe'
import { EASING_TYPES, type EasingType } from '../types/Keyframe'
import {
  InvalidModifierError,
  SerializationError,
  ModifierStackError,
} from '../errors/EffectErrors'

// ---------------------------------------------------------------------------
// Modifier Validator
// ---------------------------------------------------------------------------

/** Centralized validation for Modifier structures. Single source of truth. */
export class ModifierValidator {
  /**
   * Validate a complete Modifier object.
   * Returns a structured result — never throws for validation failures.
   */
  validate(modifier: Modifier): ValidationResult {
    const errors: ValidationError[] = []

    // id
    if (typeof modifier.id !== 'string' || modifier.id.length === 0) {
      errors.push({ field: 'id', message: 'Must be a non-empty string.' })
    }

    // type
    if (
      modifier.type !== 'effect' &&
      modifier.type !== 'animation' &&
      modifier.type !== 'transition'
    ) {
      errors.push({
        field: 'type',
        message: 'Must be "effect", "animation", or "transition".',
      })
    }

    // presetId
    if (typeof modifier.presetId !== 'string' || modifier.presetId.length === 0) {
      errors.push({ field: 'presetId', message: 'Must be a non-empty string.' })
    }

    // enabled
    if (typeof modifier.enabled !== 'boolean') {
      errors.push({ field: 'enabled', message: 'Must be a boolean.' })
    }

    // parameters
    if (typeof modifier.parameters !== 'object' || modifier.parameters === null || Array.isArray(modifier.parameters)) {
      errors.push({ field: 'parameters', message: 'Must be a plain object.' })
    } else {
      for (const [key, value] of Object.entries(modifier.parameters)) {
        if (
          typeof value !== 'number' &&
          typeof value !== 'string' &&
          typeof value !== 'boolean'
        ) {
          errors.push({
            field: `parameters.${key}`,
            message: 'Value must be a number, string, or boolean.',
          })
        }
      }
    }

    // keyframes
    if (!Array.isArray(modifier.keyframes)) {
      errors.push({ field: 'keyframes', message: 'Must be an array.' })
    } else {
      const trackErrors = this.validateKeyframeTracks(modifier.keyframes)
      errors.push(...trackErrors)
    }

    // version
    if (typeof modifier.version !== 'number' || modifier.version < 1) {
      errors.push({ field: 'version', message: 'Must be a positive integer.' })
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Validate and throw on first error.
   * @throws InvalidModifierError on the first validation failure.
   */
  validateOrThrow(modifier: Modifier): void {
    const result = this.validate(modifier)
    if (!result.valid) {
      const first = result.errors[0]
      throw new InvalidModifierError(first.field, first.message)
    }
  }

  private validateKeyframeTracks(tracks: KeyframeTrack[]): ValidationError[] {
    const errors: ValidationError[] = []

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]

      if (typeof track.property !== 'string' || track.property.length === 0) {
        errors.push({
          field: `keyframes[${i}].property`,
          message: 'Must be a non-empty string.',
        })
      }

      if (!Array.isArray(track.frames) || track.frames.length === 0) {
        errors.push({
          field: `keyframes[${i}].frames`,
          message: 'Must be a non-empty array.',
        })
        continue
      }

      // Frames must be sorted by time
      for (let j = 0; j < track.frames.length; j++) {
        const frame = track.frames[j]
        const frameErrors = this.validateKeyframe(frame, `keyframes[${i}].frames[${j}]`)
        errors.push(...frameErrors)

        if (j > 0 && track.frames[j - 1].time > frame.time) {
          errors.push({
            field: `keyframes[${i}].frames[${j}].time`,
            message: 'Frames must be sorted in ascending time order.',
          })
        }
      }
    }

    return errors
  }

  private validateKeyframe(frame: Keyframe, path: string): ValidationError[] {
    const errors: ValidationError[] = []

    if (typeof frame.time !== 'number' || frame.time < 0) {
      errors.push({ field: `${path}.time`, message: 'Must be a non-negative number.' })
    }

    if (
      typeof frame.value !== 'number' &&
      typeof frame.value !== 'string' &&
      typeof frame.value !== 'boolean'
    ) {
      errors.push({
        field: `${path}.value`,
        message: 'Must be a number, string, or boolean.',
      })
    }

    const validEasings: ReadonlySet<string> = new Set<string>(EASING_TYPES as readonly string[])
    if (typeof frame.easing !== 'string' || !validEasings.has(frame.easing)) {
      errors.push({
        field: `${path}.easing`,
        message: `Must be one of: ${EASING_TYPES.join(', ')}.`,
      })
    }

    return errors
  }
}

// ---------------------------------------------------------------------------
// Modifier Engine
// ---------------------------------------------------------------------------

/**
 * Pure engine for modifier stack operations.
 *
 * All methods return new arrays — input is never mutated.
 * No React, no Zustand, no Electron, no FFmpeg, no Canvas, no DOM.
 */
export class ModifierEngine {
  private readonly validator: ModifierValidator

  constructor(validator?: ModifierValidator) {
    this.validator = validator ?? new ModifierValidator()
  }

  // ---------------------------------------------------------------------------
  // Stack operations
  // ---------------------------------------------------------------------------

  /**
   * Attach a modifier to the end of a stack.
   * Validates the modifier before attaching.
   * @throws InvalidModifierError if the modifier fails validation.
   * @throws ModifierStackError if a modifier with the same ID already exists in the stack.
   * @returns A new stack with the modifier appended.
   */
  attachModifier(stack: ReadonlyArray<Modifier>, modifier: Modifier): Modifier[] {
    this.validator.validateOrThrow(modifier)

    if (stack.some((m) => m.id === modifier.id)) {
      throw new ModifierStackError(
        `Modifier "${modifier.id}" already exists in the stack.`
      )
    }

    return [...stack, { ...modifier }]
  }

  /**
   * Detach (remove) a modifier from the stack by ID.
   * @throws ModifierStackError if the modifier ID is not found.
   * @returns A new stack without the specified modifier.
   */
  detachModifier(stack: ReadonlyArray<Modifier>, modifierId: string): Modifier[] {
    const index = stack.findIndex((m) => m.id === modifierId)
    if (index === -1) {
      throw new ModifierStackError(
        `Modifier "${modifierId}" not found in stack.`
      )
    }
    return stack.filter((m) => m.id !== modifierId).map((m) => ({ ...m }))
  }

  /**
   * Move a modifier to a new position in the stack.
   * @throws ModifierStackError if the modifier ID is not found or the new index is out of bounds.
   * @returns A new stack with the modifier reordered.
   */
  reorderModifier(
    stack: ReadonlyArray<Modifier>,
    modifierId: string,
    newIndex: number
  ): Modifier[] {
    const currentIndex = stack.findIndex((m) => m.id === modifierId)
    if (currentIndex === -1) {
      throw new ModifierStackError(
        `Modifier "${modifierId}" not found in stack.`
      )
    }

    if (newIndex < 0 || newIndex >= stack.length) {
      throw new ModifierStackError(
        `Target index ${newIndex} is out of bounds [0, ${stack.length - 1}].`
      )
    }

    if (currentIndex === newIndex) {
      return stack.map((m) => ({ ...m }))
    }

    const result = stack.map((m) => ({ ...m }))
    const [moved] = result.splice(currentIndex, 1)
    result.splice(newIndex, 0, moved)
    return result
  }

  /**
   * Update a modifier's mutable properties (enabled, parameters, keyframes).
   * Re-validates the resulting modifier.
   * @throws ModifierStackError if the modifier ID is not found.
   * @throws InvalidModifierError if the patched modifier fails validation.
   * @returns A new stack with the updated modifier.
   */
  updateModifier(
    stack: ReadonlyArray<Modifier>,
    modifierId: string,
    patch: ModifierPatch
  ): Modifier[] {
    const index = stack.findIndex((m) => m.id === modifierId)
    if (index === -1) {
      throw new ModifierStackError(
        `Modifier "${modifierId}" not found in stack.`
      )
    }

    const existing = stack[index]

    const updated: Modifier = {
      ...existing,
      enabled: patch.enabled ?? existing.enabled,
      parameters: patch.parameters
        ? { ...existing.parameters, ...patch.parameters }
        : existing.parameters,
      keyframes: patch.keyframes ?? existing.keyframes,
    }

    // Re-validate the merged result
    this.validator.validateOrThrow(updated)

    const result = stack.map((m) => ({ ...m }))
    result[index] = updated
    return result
  }

  /**
   * Validate a single modifier without modifying any stack.
   * @returns Structured validation result.
   */
  validateModifier(modifier: Modifier): ValidationResult {
    return this.validator.validate(modifier)
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize a modifier stack to a deterministic JSON string.
   * The output includes schema version for forward compatibility.
   * @throws SerializationError if serialization fails.
   */
  serializeModifierStack(stack: ReadonlyArray<Modifier>): string {
    try {
      const payload = {
        version: MODIFIER_SCHEMA_VERSION,
        modifiers: stack.map((m) => ({
          id: m.id,
          type: m.type,
          presetId: m.presetId,
          enabled: m.enabled,
          parameters: sortRecordKeys(m.parameters),
          keyframes: m.keyframes.map((track) => ({
            property: track.property,
            frames: track.frames.map((f) => ({
              time: f.time,
              value: f.value,
              easing: f.easing,
            })),
          })),
          version: m.version,
        })),
      }
      return JSON.stringify(payload, null, 2)
    } catch (e) {
      throw new SerializationError('serialize', (e as Error).message)
    }
  }

  /**
   * Deserialize a JSON string into a Modifier[].
   * Validates every modifier before returning.
   * @throws SerializationError if JSON parsing fails.
   * @throws InvalidModifierError if any modifier fails validation.
   */
  deserializeModifierStack(json: string): Modifier[] {
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(json) as Record<string, unknown>
    } catch (e) {
      throw new SerializationError('deserialize', `Invalid JSON: ${(e as Error).message}`)
    }

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new SerializationError('deserialize', 'Root must be a plain object.')
    }

    const version = raw['version']
    if (typeof version !== 'number') {
      throw new SerializationError('deserialize', 'Missing or invalid "version" field.')
    }

    if (version > MODIFIER_SCHEMA_VERSION) {
      throw new SerializationError(
        'deserialize',
        `Unsupported schema version ${version}. Maximum: ${MODIFIER_SCHEMA_VERSION}.`
      )
    }

    const rawModifiers = raw['modifiers']
    if (!Array.isArray(rawModifiers)) {
      throw new SerializationError('deserialize', '"modifiers" must be an array.')
    }

    const result: Modifier[] = []
    for (let i = 0; i < rawModifiers.length; i++) {
      const rawMod = rawModifiers[i]
      if (typeof rawMod !== 'object' || rawMod === null || Array.isArray(rawMod)) {
        throw new SerializationError('deserialize', `modifiers[${i}] must be a plain object.`)
      }
      const modifier = parseModifier(rawMod as Record<string, unknown>, i)
      this.validator.validateOrThrow(modifier)
      result.push(modifier)
    }

    return result
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a raw object into a Modifier, throwing SerializationError on type mismatches. */
function parseModifier(raw: Record<string, unknown>, index: number): Modifier {
  const path = `modifiers[${index}]`

  if (typeof raw['id'] !== 'string') {
    throw new SerializationError('deserialize', `${path}.id must be a string.`)
  }
  if (
    raw['type'] !== 'effect' &&
    raw['type'] !== 'animation' &&
    raw['type'] !== 'transition'
  ) {
    throw new SerializationError('deserialize', `${path}.type must be "effect", "animation", or "transition".`)
  }
  if (typeof raw['presetId'] !== 'string') {
    throw new SerializationError('deserialize', `${path}.presetId must be a string.`)
  }
  if (typeof raw['enabled'] !== 'boolean') {
    throw new SerializationError('deserialize', `${path}.enabled must be a boolean.`)
  }
  if (typeof raw['parameters'] !== 'object' || raw['parameters'] === null || Array.isArray(raw['parameters'])) {
    throw new SerializationError('deserialize', `${path}.parameters must be a plain object.`)
  }
  if (!Array.isArray(raw['keyframes'])) {
    throw new SerializationError('deserialize', `${path}.keyframes must be an array.`)
  }
  if (typeof raw['version'] !== 'number') {
    throw new SerializationError('deserialize', `${path}.version must be a number.`)
  }

  const parameters: Record<string, ModifierParameterValue> = {}
  for (const [key, val] of Object.entries(raw['parameters'] as Record<string, unknown>)) {
    if (typeof val !== 'number' && typeof val !== 'string' && typeof val !== 'boolean') {
      throw new SerializationError(
        'deserialize',
        `${path}.parameters.${key} must be a number, string, or boolean.`
      )
    }
    parameters[key] = val as ModifierParameterValue
  }

  const keyframes = parseKeyframeTracks(raw['keyframes'] as unknown[], path)

  return {
    id: raw['id'] as string,
    type: raw['type'] as Modifier['type'],
    presetId: raw['presetId'] as string,
    enabled: raw['enabled'] as boolean,
    parameters,
    keyframes,
    version: raw['version'] as number,
  }
}

function parseKeyframeTracks(raw: unknown[], parentPath: string): KeyframeTrack[] {
  const tracks: KeyframeTrack[] = []
  for (let i = 0; i < raw.length; i++) {
    const track = raw[i]
    if (typeof track !== 'object' || track === null || Array.isArray(track)) {
      throw new SerializationError('deserialize', `${parentPath}.keyframes[${i}] must be a plain object.`)
    }
    const t = track as Record<string, unknown>
    if (typeof t['property'] !== 'string') {
      throw new SerializationError('deserialize', `${parentPath}.keyframes[${i}].property must be a string.`)
    }
    if (!Array.isArray(t['frames'])) {
      throw new SerializationError('deserialize', `${parentPath}.keyframes[${i}].frames must be an array.`)
    }

    const frames: Keyframe[] = []
    for (let j = 0; j < (t['frames'] as unknown[]).length; j++) {
      const frame = (t['frames'] as unknown[])[j]
      if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
        throw new SerializationError(
          'deserialize',
          `${parentPath}.keyframes[${i}].frames[${j}] must be a plain object.`
        )
      }
      const f = frame as Record<string, unknown>
      if (typeof f['time'] !== 'number') {
        throw new SerializationError('deserialize', `${parentPath}.keyframes[${i}].frames[${j}].time must be a number.`)
      }
      if (
        typeof f['value'] !== 'number' &&
        typeof f['value'] !== 'string' &&
        typeof f['value'] !== 'boolean'
      ) {
        throw new SerializationError(
          'deserialize',
          `${parentPath}.keyframes[${i}].frames[${j}].value must be a number, string, or boolean.`
        )
      }
      if (typeof f['easing'] !== 'string') {
        throw new SerializationError(
          'deserialize',
          `${parentPath}.keyframes[${i}].frames[${j}].easing must be a string.`
        )
      }
      frames.push({
        time: f['time'] as number,
        value: f['value'] as number | string | boolean,
        easing: f['easing'] as EasingType,
      })
    }

    tracks.push({ property: t['property'] as string, frames })
  }
  return tracks
}

/** Sort record keys alphabetically for deterministic JSON output. */
function sortRecordKeys(record: Record<string, ModifierParameterValue>): Record<string, ModifierParameterValue> {
  const sorted: Record<string, ModifierParameterValue> = {}
  for (const key of [...Object.keys(record)].sort()) {
    sorted[key] = record[key]
  }
  return sorted
}
