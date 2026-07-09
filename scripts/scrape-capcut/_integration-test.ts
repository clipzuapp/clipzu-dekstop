/**
 * Integration test — verify all generated .ccpreset files pass
 * the EXACT same validation as PresetRegistry.validatePresetSchema().
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

// ---- Identical copy of PresetRegistry.validatePresetSchema ----
function validateParameters(value: unknown): void {
  if (value !== undefined && value !== null) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('parameters: Must be a plain object when present.')
    }
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val !== 'number' && typeof val !== 'string' && typeof val !== 'boolean') {
        throw new Error(`parameters.${key}: Must be number, string, or boolean. Got: ${typeof val}`)
      }
    }
  }
}

function validateKeyframeTracks(tracks: unknown[]): void {
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]
    if (typeof track !== 'object' || track === null || Array.isArray(track)) {
      throw new Error(`keyframes[${i}]: Must be a plain object.`)
    }
    const t = track as Record<string, unknown>
    if (typeof t['property'] !== 'string' || (t['property'] as string).length === 0) {
      throw new Error(`keyframes[${i}].property: Must be a non-empty string.`)
    }
    if (!Array.isArray(t['frames']) || (t['frames'] as unknown[]).length === 0) {
      throw new Error(`keyframes[${i}].frames: Must be a non-empty array.`)
    }
    for (let j = 0; j < (t['frames'] as unknown[]).length; j++) {
      const frame = (t['frames'] as unknown[])[j] as Record<string, unknown>
      if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
        throw new Error(`keyframes[${i}].frames[${j}]: Must be a plain object.`)
      }
      if (typeof frame['time'] !== 'number') {
        throw new Error(`keyframes[${i}].frames[${j}].time: Must be a number.`)
      }
      if (typeof frame['value'] !== 'number' && typeof frame['value'] !== 'string' && typeof frame['value'] !== 'boolean') {
        throw new Error(`keyframes[${i}].frames[${j}].value: Must be number, string, or boolean.`)
      }
      if (typeof frame['easing'] !== 'string') {
        throw new Error(`keyframes[${i}].frames[${j}].easing: Must be a string.`)
      }
    }
  }
}

function validatePresetSchema(raw: Record<string, unknown>): void {
  if (typeof raw['version'] !== 'number') throw new Error('version: Must be a number.')
  if (raw['type'] !== 'effect' && raw['type'] !== 'animation' && raw['type'] !== 'transition') {
    throw new Error('type: Must be effect/animation/transition.')
  }
  if (typeof raw['name'] !== 'string' || (raw['name'] as string).length === 0) throw new Error('name: Must be non-empty.')
  if (typeof raw['author'] !== 'string' || (raw['author'] as string).length === 0) throw new Error('author: Must be non-empty.')
  if (typeof raw['category'] !== 'string' || (raw['category'] as string).length === 0) throw new Error('category: Must be non-empty.')
  if (raw['description'] !== undefined && typeof raw['description'] !== 'string') throw new Error('description: Must be string.')
  if (raw['tags'] !== undefined) {
    if (!Array.isArray(raw['tags']) || !(raw['tags'] as unknown[]).every(t => typeof t === 'string')) throw new Error('tags: Must be string array.')
  }
  const type = raw['type'] as string
  if (type === 'effect') validateParameters(raw['parameters'])
  else if (type === 'animation') {
    if (typeof raw['duration'] !== 'number' || (raw['duration'] as number) < 0) throw new Error('duration: Must be non-negative.')
    if (!Array.isArray(raw['keyframes'])) throw new Error('keyframes: Must be array.')
    validateKeyframeTracks(raw['keyframes'] as unknown[])
  } else if (type === 'transition') {
    if (typeof raw['duration'] !== 'number' || (raw['duration'] as number) < 0) throw new Error('duration: Must be non-negative.')
    validateParameters(raw['parameters'])
  }
}

// ---- Test all generated files ----
const baseDir = join(ROOT, 'data', 'output', 'presets')
let total = 0, passed = 0, failed = 0
const failures: Array<{ file: string; error: string }> = []

for (const subDir of ['effects', 'transitions', 'animations']) {
  const dir = join(baseDir, subDir)
  const files = readdirSync(dir).filter(f => f.endsWith('.ccpreset'))
  for (const file of files) {
    total++
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>
      validatePresetSchema(raw)
      passed++
    } catch (err) {
      failed++
      failures.push({ file: `${subDir}/${file}`, error: (err as Error).message })
    }
  }
}

console.log('=== PresetRegistry Schema Validation (app-identical) ===')
console.log(`Total:  ${total}`)
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ${f.file}: ${f.error}`)
  process.exit(1)
} else {
  console.log(`\nAll ${passed} presets pass PresetRegistry validation!`)
}
