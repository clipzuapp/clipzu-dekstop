/**
 * Phase 4 — Batch Import & Validation
 *
 * Loads all generated .ccpreset files, validates them against the CapCraft
 * PresetRegistry schema, and generates a final validated manifest.
 *
 * This script does NOT import into the running app's PresetRegistry (that
 * requires the Electron renderer context). Instead, it replicates the
 * validation logic from PresetRegistry to verify schema compliance.
 *
 * Usage:  npx tsx scripts/scrape-capcut/batch-import.ts
 * Input:  data/output/presets/[subdirs]/*.ccpreset
 * Output: data/output/validated-manifest.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const PRESETS_DIR = join(ROOT, 'data', 'output', 'presets')
const OUT_FILE = join(ROOT, 'data', 'output', 'validated-manifest.json')

// ---------------------------------------------------------------------------
// Schema validation (mirrors PresetRegistry.validatePresetSchema)
//
// IMPORTANT: Must match PresetRegistry.ts exactly. Parameters are PRIMITIVES
// (number | string | boolean), NOT objects with {type, value}.
// ---------------------------------------------------------------------------

const PRESET_SCHEMA_VERSION = 1

interface ValidationError {
  file: string
  field: string
  message: string
}

interface ValidationResult {
  file: string
  valid: boolean
  errors: ValidationError[]
  preset?: {
    id: string
    name: string
    type: string
    category: string
    author: string
    description?: string
    tags?: string[]
    parameterCount: number
    keyframeTrackCount: number
    duration?: number
  }
}

function validateCcpreset(filePath: string): ValidationResult {
  const errors: ValidationError[] = []
  const fileName = filePath

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
  } catch (e) {
    return {
      file: fileName,
      valid: false,
      errors: [{ file: fileName, field: 'json', message: `Invalid JSON: ${(e as Error).message}` }]
    }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      file: fileName,
      valid: false,
      errors: [{ file: fileName, field: 'root', message: 'Preset must be a plain object.' }]
    }
  }

  // version
  if (typeof raw['version'] !== 'number') {
    errors.push({ file: fileName, field: 'version', message: 'Must be a number.' })
  } else if (raw['version'] > PRESET_SCHEMA_VERSION) {
    errors.push({ file: fileName, field: 'version', message: `Version ${raw['version']} > supported ${PRESET_SCHEMA_VERSION}` })
  }

  // type
  const validTypes = ['effect', 'animation', 'transition']
  if (typeof raw['type'] !== 'string' || !validTypes.includes(raw['type'] as string)) {
    errors.push({ file: fileName, field: 'type', message: 'Must be "effect", "animation", or "transition".' })
  }

  // name
  if (typeof raw['name'] !== 'string' || (raw['name'] as string).length === 0) {
    errors.push({ file: fileName, field: 'name', message: 'Must be a non-empty string.' })
  }

  // author
  if (typeof raw['author'] !== 'string' || (raw['author'] as string).length === 0) {
    errors.push({ file: fileName, field: 'author', message: 'Must be a non-empty string.' })
  }

  // category
  if (typeof raw['category'] !== 'string' || (raw['category'] as string).length === 0) {
    errors.push({ file: fileName, field: 'category', message: 'Must be a non-empty string.' })
  }

  // description (optional)
  if (raw['description'] !== undefined && typeof raw['description'] !== 'string') {
    errors.push({ file: fileName, field: 'description', message: 'Must be a string when present.' })
  }

  // tags (optional)
  if (raw['tags'] !== undefined) {
    if (!Array.isArray(raw['tags']) || !(raw['tags'] as unknown[]).every(t => typeof t === 'string')) {
      errors.push({ file: fileName, field: 'tags', message: 'Must be an array of strings when present.' })
    }
  }

  const type = raw['type'] as string

  // Type-specific validation
  if (type === 'effect') {
    validateParameters(raw['parameters'], fileName, errors)
  } else if (type === 'animation') {
    if (typeof raw['duration'] !== 'number' || (raw['duration'] as number) < 0) {
      errors.push({ file: fileName, field: 'duration', message: 'Must be a non-negative number for animation presets.' })
    }
    if (!Array.isArray(raw['keyframes'])) {
      errors.push({ file: fileName, field: 'keyframes', message: 'Must be an array for animation presets.' })
    } else {
      validateKeyframeTracks(raw['keyframes'] as unknown[], fileName, errors)
    }
  } else if (type === 'transition') {
    if (typeof raw['duration'] !== 'number' || (raw['duration'] as number) < 0) {
      errors.push({ file: fileName, field: 'duration', message: 'Must be a non-negative number for transition presets.' })
    }
    validateParameters(raw['parameters'], fileName, errors)
  }

  const parameterCount = raw['parameters'] && typeof raw['parameters'] === 'object'
    ? Object.keys(raw['parameters'] as Record<string, unknown>).length
    : 0

  const keyframeTrackCount = Array.isArray(raw['keyframes'])
    ? (raw['keyframes'] as unknown[]).length
    : 0

  return {
    file: fileName,
    valid: errors.length === 0,
    errors,
    preset: errors.length === 0
      ? {
          id: basename(filePath, '.ccpreset'),
          name: raw['name'] as string,
          type,
          category: raw['category'] as string,
          author: raw['author'] as string,
          description: raw['description'] as string | undefined,
          tags: raw['tags'] as string[] | undefined,
          parameterCount,
          keyframeTrackCount,
          duration: raw['duration'] as number | undefined
        }
      : undefined
  }
}

function validateParameters(
  params: unknown,
  fileName: string,
  errors: ValidationError[]
): void {
  // Matches PresetRegistry.validateParameters: params are optional, but when
  // present each value MUST be a primitive (number | string | boolean).
  if (params === undefined || params === null) return
  if (typeof params !== 'object' || Array.isArray(params)) {
    errors.push({ file: fileName, field: 'parameters', message: 'Must be a plain object when present.' })
    return
  }

  for (const [key, val] of Object.entries(params as Record<string, unknown>)) {
    if (typeof val !== 'number' && typeof val !== 'string' && typeof val !== 'boolean') {
      errors.push({
        file: fileName,
        field: `parameters.${key}`,
        message: 'Each parameter value must be a number, string, or boolean.'
      })
    }
  }
}

function validateKeyframeTracks(
  tracks: unknown[],
  fileName: string,
  errors: ValidationError[]
): void {
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]
    if (typeof track !== 'object' || track === null || Array.isArray(track)) {
      errors.push({ file: fileName, field: `keyframes[${i}]`, message: 'Must be an object.' })
      continue
    }

    const t = track as Record<string, unknown>
    if (typeof t['property'] !== 'string') {
      errors.push({ file: fileName, field: `keyframes[${i}].property`, message: 'Must be a string.' })
    }
    if (!Array.isArray(t['frames'])) {
      errors.push({ file: fileName, field: `keyframes[${i}].frames`, message: 'Must be an array.' })
    } else {
      for (let j = 0; j < t['frames'].length; j++) {
        const frame = t['frames'][j] as Record<string, unknown>
        if (typeof frame !== 'object' || frame === null) {
          errors.push({ file: fileName, field: `keyframes[${i}].frames[${j}]`, message: 'Must be an object.' })
          continue
        }
        if (typeof frame['time'] !== 'number') {
          errors.push({ file: fileName, field: `keyframes[${i}].frames[${j}].time`, message: 'Must be a number.' })
        }
        if (!('value' in frame)) {
          errors.push({ file: fileName, field: `keyframes[${i}].frames[${j}].value`, message: 'Must have a value.' })
        }
        if (typeof frame['easing'] !== 'string') {
          errors.push({ file: fileName, field: `keyframes[${i}].frames[${j}].easing`, message: 'Must be a string.' })
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function findCcpresetFiles(baseDir: string): string[] {
  const files: string[] = []

  for (const subDir of ['effects', 'transitions', 'animations']) {
    const dir = join(baseDir, subDir)
    if (!existsSync(dir)) continue

    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (entry.endsWith('.ccpreset')) {
        files.push(join(dir, entry))
      }
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function batchImport(): void {
  console.log('[batch-import] Starting batch validation...\n')

  const files = findCcpresetFiles(PRESETS_DIR)
  console.log(`  Found ${files.length} .ccpreset files`)

  const results: ValidationResult[] = []

  for (const file of files) {
    const result = validateCcpreset(file)
    results.push(result)

    if (!result.valid) {
      console.warn(`  INVALID: ${result.file}`)
      for (const err of result.errors) {
        console.warn(`    ${err.field}: ${err.message}`)
      }
    }
  }

  const valid = results.filter(r => r.valid)
  const invalid = results.filter(r => !r.valid)

  // Generate validated manifest
  const manifest = {
    validatedAt: new Date().toISOString(),
    totalFiles: files.length,
    valid: valid.length,
    invalid: invalid.length,
    summary: {
      effects: valid.filter(r => r.preset?.type === 'effect').length,
      transitions: valid.filter(r => r.preset?.type === 'transition').length,
      animations: valid.filter(r => r.preset?.type === 'animation').length
    },
    presets: valid
      .filter(r => r.preset)
      .map(r => r.preset!)
      .sort((a, b) => a.name.localeCompare(b.name)),
    errors: invalid.map(r => ({
      file: r.file,
      errors: r.errors
    }))
  }

  writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2))

  console.log(`\n[batch-import] Done!`)
  console.log(`  Total files:  ${files.length}`)
  console.log(`  Valid:        ${valid.length}`)
  console.log(`  Invalid:      ${invalid.length}`)
  console.log(`  Effects:      ${manifest.summary.effects}`)
  console.log(`  Transitions:  ${manifest.summary.transitions}`)
  console.log(`  Animations:   ${manifest.summary.animations}`)
  console.log(`  Manifest:     ${OUT_FILE}`)

  if (invalid.length > 0) {
    console.log(`\n  ⚠ ${invalid.length} preset(s) failed validation. See manifest for details.`)
  } else {
    console.log(`\n  All presets passed validation!`)
  }
}

batchImport()
