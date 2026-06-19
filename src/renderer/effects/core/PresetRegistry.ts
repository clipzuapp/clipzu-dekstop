// ---------------------------------------------------------------------------
// Preset Registry — .ccpreset file format support
// ---------------------------------------------------------------------------

import type {
  Preset,
  PresetData,
  PresetMetadata,
  PresetMigrationFn,
  CcpresetFile,
  EffectPresetData,
  AnimationPresetData,
  TransitionPresetData,
  PresetKeyframeTrack,
} from '../types/Preset'
import { PRESET_SCHEMA_VERSION } from '../types/Preset'
import type { ModifierParameterValue } from '../types/Modifier'
import {
  DuplicateRegistryError,
  RegistryNotFoundError,
  InvalidPresetError,
  PresetVersionError,
} from '../errors/EffectErrors'

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/** Validate that a raw object conforms to the CcpresetFile schema. */
export function validatePresetSchema(raw: Record<string, unknown>): CcpresetFile {
  // version
  if (typeof raw['version'] !== 'number') {
    throw new InvalidPresetError('version', 'Must be a number.')
  }

  // type
  if (raw['type'] !== 'effect' && raw['type'] !== 'animation' && raw['type'] !== 'transition') {
    throw new InvalidPresetError('type', 'Must be "effect", "animation", or "transition".')
  }

  // name
  if (typeof raw['name'] !== 'string' || raw['name'].length === 0) {
    throw new InvalidPresetError('name', 'Must be a non-empty string.')
  }

  // author
  if (typeof raw['author'] !== 'string' || raw['author'].length === 0) {
    throw new InvalidPresetError('author', 'Must be a non-empty string.')
  }

  // category
  if (typeof raw['category'] !== 'string' || raw['category'].length === 0) {
    throw new InvalidPresetError('category', 'Must be a non-empty string.')
  }

  // description (optional)
  if (raw['description'] !== undefined && typeof raw['description'] !== 'string') {
    throw new InvalidPresetError('description', 'Must be a string when present.')
  }

  // tags (optional)
  if (raw['tags'] !== undefined) {
    if (!Array.isArray(raw['tags']) || !raw['tags'].every((t) => typeof t === 'string')) {
      throw new InvalidPresetError('tags', 'Must be an array of strings when present.')
    }
  }

  const type = raw['type'] as string

  // Variant-specific validation
  if (type === 'effect') {
    validateParameters(raw['parameters'])
  } else if (type === 'animation') {
    if (typeof raw['duration'] !== 'number' || raw['duration'] < 0) {
      throw new InvalidPresetError('duration', 'Must be a non-negative number for animation presets.')
    }
    if (!Array.isArray(raw['keyframes'])) {
      throw new InvalidPresetError('keyframes', 'Must be an array for animation presets.')
    }
    validateKeyframeTracks(raw['keyframes'] as unknown[])
  } else if (type === 'transition') {
    if (typeof raw['duration'] !== 'number' || raw['duration'] < 0) {
      throw new InvalidPresetError('duration', 'Must be a non-negative number for transition presets.')
    }
    validateParameters(raw['parameters'])
  }

  return raw as unknown as CcpresetFile
}

function validateParameters(value: unknown): void {
  if (value !== undefined && value !== null) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new InvalidPresetError('parameters', 'Must be a plain object when present.')
    }
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val !== 'number' && typeof val !== 'string' && typeof val !== 'boolean') {
        throw new InvalidPresetError(
          `parameters.${key}`,
          'Each parameter value must be a number, string, or boolean.'
        )
      }
    }
  }
}

function validateKeyframeTracks(tracks: unknown[]): void {
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]
    if (typeof track !== 'object' || track === null || Array.isArray(track)) {
      throw new InvalidPresetError(`keyframes[${i}]`, 'Each track must be a plain object.')
    }
    const t = track as Record<string, unknown>
    if (typeof t['property'] !== 'string' || t['property'].length === 0) {
      throw new InvalidPresetError(`keyframes[${i}].property`, 'Must be a non-empty string.')
    }
    if (!Array.isArray(t['frames']) || t['frames'].length === 0) {
      throw new InvalidPresetError(`keyframes[${i}].frames`, 'Must be a non-empty array.')
    }
    for (let j = 0; j < (t['frames'] as unknown[]).length; j++) {
      const frame = (t['frames'] as unknown[])[j]
      if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
        throw new InvalidPresetError(`keyframes[${i}].frames[${j}]`, 'Each frame must be a plain object.')
      }
      const f = frame as Record<string, unknown>
      if (typeof f['time'] !== 'number') {
        throw new InvalidPresetError(`keyframes[${i}].frames[${j}].time`, 'Must be a number.')
      }
      if (
        typeof f['value'] !== 'number' &&
        typeof f['value'] !== 'string' &&
        typeof f['value'] !== 'boolean'
      ) {
        throw new InvalidPresetError(
          `keyframes[${i}].frames[${j}].value`,
          'Must be a number, string, or boolean.'
        )
      }
      if (typeof f['easing'] !== 'string') {
        throw new InvalidPresetError(`keyframes[${i}].frames[${j}].easing`, 'Must be a string.')
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Migration entry point
// ---------------------------------------------------------------------------

/**
 * Version migration map. Keyed by source version → produces next version.
 * Extend as schema evolves.
 */
const MIGRATIONS: ReadonlyMap<number, PresetMigrationFn> = new Map([
  // Example: version 1 → 2 migration will be added here when version 2 ships.
  // [1, (data) => { ...transform... }],
])

/**
 * Apply sequential migrations from the file's version up to PRESET_SCHEMA_VERSION.
 * Returns the migrated data object.
 */
function applyMigrations(data: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let current = data
  let version = fromVersion
  while (version < PRESET_SCHEMA_VERSION) {
    const migrate = MIGRATIONS.get(version)
    if (!migrate) {
      throw new PresetVersionError(version, PRESET_SCHEMA_VERSION)
    }
    current = migrate(current)
    version++
  }
  return current
}

// ---------------------------------------------------------------------------
// CcpresetFile ↔ Preset conversion
// ---------------------------------------------------------------------------

function ccPresetFileToPreset(file: CcpresetFile, id: string): Preset {
  const metadata: PresetMetadata = {
    version: file.version,
    type: file.type,
    name: file.name,
    author: file.author,
    category: file.category,
    description: file.description,
    tags: file.tags ? Object.freeze([...file.tags]) : undefined,
  }

  let data: PresetData

  if (file.type === 'effect') {
    const effectData: EffectPresetData = {
      type: 'effect',
      parameters: (file.parameters ?? {}) as Record<string, ModifierParameterValue>,
    }
    data = effectData
  } else if (file.type === 'animation') {
    const animationData: AnimationPresetData = {
      type: 'animation',
      duration: file.duration ?? 0,
      keyframes: (file.keyframes ?? []) as PresetKeyframeTrack[],
    }
    data = animationData
  } else {
    const transitionData: TransitionPresetData = {
      type: 'transition',
      duration: file.duration ?? 0,
      parameters: (file.parameters ?? {}) as Record<string, ModifierParameterValue>,
    }
    data = transitionData
  }

  return { id, metadata, data }
}

function presetToCcpresetFile(preset: Preset): CcpresetFile {
  const base: CcpresetFile = {
    version: preset.metadata.version,
    type: preset.metadata.type,
    name: preset.metadata.name,
    author: preset.metadata.author,
    category: preset.metadata.category,
    description: preset.metadata.description,
    tags: preset.metadata.tags ? [...preset.metadata.tags] : undefined,
  }

  if (preset.data.type === 'effect') {
    base.parameters = preset.data.parameters as Record<string, ModifierParameterValue>
  } else if (preset.data.type === 'animation') {
    base.duration = preset.data.duration
    base.keyframes = preset.data.keyframes
  } else {
    base.duration = preset.data.duration
    base.parameters = preset.data.parameters as Record<string, ModifierParameterValue>
  }

  return base
}

// ---------------------------------------------------------------------------
// PresetRegistry class
// ---------------------------------------------------------------------------

/**
 * Registry for presets (.ccpreset format).
 *
 * Class-based — instantiate for isolated test environments.
 * No module-level singletons.
 */
export class PresetRegistry {
  private readonly presets: Map<string, Preset> = new Map()
  private readonly registryName: string

  constructor(name = 'PresetRegistry') {
    this.registryName = name
  }

  // ---------------------------------------------------------------------------
  // Mutating operations
  // ---------------------------------------------------------------------------

  /**
   * Register a preset.
   * @throws DuplicateRegistryError if a preset with the same ID already exists.
   */
  register(preset: Preset): void {
    if (this.presets.has(preset.id)) {
      throw new DuplicateRegistryError(this.registryName, preset.id)
    }
    this.presets.set(preset.id, preset)
  }

  /**
   * Unregister a preset by ID.
   * @throws RegistryNotFoundError if not found.
   */
  unregister(id: string): void {
    if (!this.presets.has(id)) {
      throw new RegistryNotFoundError(this.registryName, id)
    }
    this.presets.delete(id)
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /**
   * Get a preset by ID.
   * @throws RegistryNotFoundError if not found.
   */
  get(id: string): Preset {
    const preset = this.presets.get(id)
    if (!preset) {
      throw new RegistryNotFoundError(this.registryName, id)
    }
    return preset
  }

  /** Check whether a preset exists. */
  exists(id: string): boolean {
    return this.presets.has(id)
  }

  /** List all registered presets in insertion order. */
  list(): ReadonlyArray<Preset> {
    return Object.freeze([...this.presets.values()])
  }

  /**
   * Search presets by name, category, or tags (case-insensitive substring).
   */
  search(query: string): ReadonlyArray<Preset> {
    const lowerQuery = query.toLowerCase()
    const results: Preset[] = []
    for (const preset of this.presets.values()) {
      const nameMatch = preset.metadata.name.toLowerCase().includes(lowerQuery)
      const categoryMatch = preset.metadata.category.toLowerCase().includes(lowerQuery)
      const tagMatch = preset.metadata.tags?.some((tag) =>
        tag.toLowerCase().includes(lowerQuery)
      )
      if (nameMatch || categoryMatch || tagMatch) {
        results.push(preset)
      }
    }
    return Object.freeze(results)
  }

  /** Number of registered presets. */
  get size(): number {
    return this.presets.size
  }

  // ---------------------------------------------------------------------------
  // .ccpreset file I/O
  // ---------------------------------------------------------------------------

  /**
   * Load a preset from a JSON string (.ccpreset file content).
   * Validates schema, applies migrations if needed, registers the preset.
   *
   * @param jsonString — Raw JSON string from a .ccpreset file.
   * @param id — Explicit ID to register under. If omitted, derived from name.
   * @returns The registered Preset.
   * @throws InvalidPresetError on schema validation failure.
   * @throws PresetVersionError on unsupported version with no migration path.
   * @throws DuplicateRegistryError if the derived/explicit ID already exists.
   */
  loadPreset(jsonString: string, id?: string): Preset {
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(jsonString) as Record<string, unknown>
    } catch (e) {
      throw new InvalidPresetError('json', `Invalid JSON: ${(e as Error).message}`)
    }

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new InvalidPresetError('root', 'Preset JSON must be a plain object.')
    }

    // Version check + migration
    const rawVersion = raw['version']
    if (typeof rawVersion !== 'number') {
      throw new InvalidPresetError('version', 'Must be a number.')
    }

    if (rawVersion > PRESET_SCHEMA_VERSION) {
      throw new PresetVersionError(rawVersion, PRESET_SCHEMA_VERSION)
    }

    if (rawVersion < PRESET_SCHEMA_VERSION) {
      raw = applyMigrations(raw, rawVersion)
      raw['version'] = PRESET_SCHEMA_VERSION
    }

    // Schema validation
    const validated = validatePresetSchema(raw)

    // Derive ID from name if not explicitly provided
    const presetId = id ?? slugify(validated.name)

    const preset = ccPresetFileToPreset(validated, presetId)
    this.register(preset)
    return preset
  }

  /**
   * Serialize a registered preset to a .ccpreset JSON string.
   * @param id — Preset ID to serialize.
   * @returns Deterministic JSON string.
   * @throws RegistryNotFoundError if not found.
   */
  savePreset(id: string): string {
    const preset = this.get(id)
    const file = presetToCcpresetFile(preset)
    return JSON.stringify(file, null, 2)
  }

  /** Remove all registered presets. Primarily for test teardown. */
  clear(): void {
    this.presets.clear()
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Convert a preset name to a URL/filesystem-safe slug ID. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
