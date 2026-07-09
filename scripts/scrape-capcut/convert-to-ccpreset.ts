/**
 * Phase 3 — Convert to CapCraft .ccpreset
 *
 * Reads normalized CapCut presets and converts them to CapCraft .ccpreset
 * JSON files, mapping categories and parameter schemas to CapCraft equivalents.
 *
 * Usage:  npx tsx scripts/scrape-capcut/convert-to-ccpreset.ts
 * Input:  data/normalized/capcut-presets.json
 * Output: data/output/presets/effects/*.ccpreset
 *         data/output/presets/transitions/*.ccpreset
 *         data/output/presets/animations/*.ccpreset
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  slugify,
  validateEffectCategory,
  validateTransitionCategory,
  validateAnimationCategory
} from './_shared'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const NORMALIZED_FILE = join(ROOT, 'data', 'normalized', 'capcut-presets.json')
const OUT_BASE = join(ROOT, 'data', 'output', 'presets')

// ---------------------------------------------------------------------------
// CapCraft .ccpreset types (mirrors src/renderer/effects/types/Preset.ts)
//
// IMPORTANT: ModifierParameterValue = number | string | boolean  (PRIMITIVES)
// The PresetRegistry.validateParameters() enforces this.
// ---------------------------------------------------------------------------

/** Primitive parameter value — matches ModifierParameterValue in Modifier.ts */
type ModifierParameterValue = number | string | boolean

interface CcpresetFile {
  version: 1
  type: 'effect' | 'animation' | 'transition'
  name: string
  author: string
  category: string
  description?: string
  tags?: string[]
  parameters?: Record<string, ModifierParameterValue>
  duration?: number
  keyframes?: PresetKeyframeTrack[]
}

interface PresetKeyframeEntry {
  time: number
  value: number | string | boolean
  easing: string
}

interface PresetKeyframeTrack {
  property: string
  frames: PresetKeyframeEntry[]
}

// ---------------------------------------------------------------------------
// Normalized input type (from Phase 2)
// ---------------------------------------------------------------------------

interface NormalizedPreset {
  id: string
  name: string
  presetType: 'effect' | 'transition' | 'filter' | 'text-animation'
  category: string
  capcutCategory: string
  description: string
  tags: string[]
  source: string
  confidence: number
  parameters: Array<{
    name: string
    type: 'number' | 'string' | 'boolean' | 'enum'
    defaultValue: unknown
    min?: number
    max?: number
    enumValues?: string[]
    description?: string
  }>
  keyframes: Record<string, unknown>
  capcutId: string
  thumbnailUrl?: string
  isPro: boolean
}

interface NormalizedCatalog {
  normalizedAt: string
  totalPresets: number
  presets: NormalizedPreset[]
}

// ---------------------------------------------------------------------------
// Conversion logic
// ---------------------------------------------------------------------------

/**
 * Convert normalized parameters to CapCraft ModifierParameterValue map.
 *
 * IMPORTANT: ModifierParameterValue = number | string | boolean (primitives).
 * The PresetRegistry.validateParameters() rejects non-primitive values.
 */
function convertParameters(
  params: NormalizedPreset['parameters']
): Record<string, ModifierParameterValue> {
  const result: Record<string, ModifierParameterValue> = {}

  for (const param of params) {
    switch (param.type) {
      case 'number':
        result[param.name] = typeof param.defaultValue === 'number' ? param.defaultValue : 0
        break
      case 'string':
        result[param.name] = typeof param.defaultValue === 'string' ? param.defaultValue : ''
        break
      case 'boolean':
        result[param.name] = typeof param.defaultValue === 'boolean' ? param.defaultValue : false
        break
      case 'enum':
        // Enum values are stored as strings
        result[param.name] = typeof param.defaultValue === 'string'
          ? param.defaultValue
          : (param.enumValues?.[0] ?? '')
        break
      default: {
        // Unknown type — store as string primitive
        const exhaustive: never = param.type
        result[param.name] = String(param.defaultValue ?? '')
        void exhaustive
      }
    }
  }

  return result
}

/** Convert normalized keyframe data to CapCraft PresetKeyframeTrack[]. */
function convertKeyframes(kfData: Record<string, unknown>): PresetKeyframeTrack[] {
  const tracks: PresetKeyframeTrack[] = []

  // Handle graphs format: { graphs: { property: [{ keyframe_list: [...] }] } }
  const graphs = kfData.graphs as Record<string, unknown[]> | undefined
  if (graphs && typeof graphs === 'object') {
    for (const [property, trackList] of Object.entries(graphs)) {
      if (!Array.isArray(trackList)) continue

      for (const track of trackList) {
        if (!track || typeof track !== 'object') continue
        const t = track as Record<string, unknown>
        const keyframeList = t.keyframe_list as Array<{ time?: number; value?: number }> | undefined
        if (!keyframeList || !Array.isArray(keyframeList)) continue

        const frames: PresetKeyframeEntry[] = keyframeList
          .filter(kf => kf.time !== undefined && kf.value !== undefined)
          .map(kf => ({
            time: kf.time!,
            value: kf.value!,
            easing: 'ease-in-out' // default easing for CapCut keyframes
          }))

        if (frames.length > 0) {
          tracks.push({ property, frames })
        }
      }
    }
  }

  // Handle flat keyframes format: { keyframes: { property: [...] } }
  const flatKf = kfData.keyframes as Record<string, unknown> | undefined
  if (flatKf && typeof flatKf === 'object') {
    for (const [property, frames] of Object.entries(flatKf)) {
      if (!Array.isArray(frames)) continue

      const kfFrames: PresetKeyframeEntry[] = frames
        .filter((kf): kf is { time: number; value: number | string | boolean } =>
          typeof kf === 'object' && kf !== null && 'time' in kf && 'value' in kf)
        .map(kf => ({
          time: kf.time,
          value: kf.value,
          easing: 'ease-in-out'
        }))

      if (kfFrames.length > 0) {
        tracks.push({ property, frames: kfFrames })
      }
    }
  }

  return tracks
}

/** Generate a default animation keyframe set for presets that lack keyframe data. */
function generateDefaultAnimationKeyframes(durationMs: number): PresetKeyframeTrack[] {
  return [
    {
      property: 'opacity',
      frames: [
        { time: 0, value: 0, easing: 'ease-out' },
        { time: durationMs, value: 1, easing: 'linear' }
      ]
    },
    {
      property: 'scale',
      frames: [
        { time: 0, value: 0.8, easing: 'ease-out' },
        { time: durationMs, value: 1, easing: 'linear' }
      ]
    }
  ]
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

function convert(): void {
  console.log('[convert-to-ccpreset] Starting conversion...\n')

  if (!existsSync(NORMALIZED_FILE)) {
    console.error(`  Error: Normalized file not found: ${NORMALIZED_FILE}`)
    console.error('  Run normalize.ts first.')
    process.exit(1)
  }

  const catalog: NormalizedCatalog = JSON.parse(readFileSync(NORMALIZED_FILE, 'utf-8'))
  console.log(`  Loaded ${catalog.totalPresets} normalized presets`)

  const stats = { effects: 0, transitions: 0, animations: 0, skipped: 0 }
  const manifest: Array<{
    id: string
    name: string
    type: string
    category: string
    file: string
    capcutId: string
    confidence: number
    isPro: boolean
  }> = []

  for (const preset of catalog.presets) {
    let ccPreset: CcpresetFile
    let subDir: string
    let ccType: 'effect' | 'animation' | 'transition'

    switch (preset.presetType) {
      case 'effect':
      case 'filter': {
        // Effects and filters both map to effect presets
        ccType = 'effect'
        subDir = 'effects'
        ccPreset = {
          version: 1,
          type: 'effect',
          name: preset.name,
          author: 'CapCut (imported)',
          category: validateEffectCategory(preset.category),
          description: preset.description ?? `Imported from CapCut ${preset.capcutCategory}`,
          tags: [...preset.tags, 'capcut-import'],
          parameters: convertParameters(preset.parameters)
        }
        break
      }

      case 'transition': {
        ccType = 'transition'
        subDir = 'transitions'
        const duration = 500 // default 500ms transition

        ccPreset = {
          version: 1,
          type: 'transition',
          name: preset.name,
          author: 'CapCut (imported)',
          category: validateTransitionCategory(preset.category),
          description: preset.description ?? `Imported from CapCut ${preset.capcutCategory}`,
          tags: [...preset.tags, 'capcut-import'],
          duration,
          parameters: convertParameters(preset.parameters)
        }
        break
      }

      case 'text-animation': {
        ccType = 'animation'
        subDir = 'animations'
        const duration = 300 // default 300ms animation

        const keyframes = Object.keys(preset.keyframes).length > 0
          ? convertKeyframes(preset.keyframes)
          : generateDefaultAnimationKeyframes(duration)

        ccPreset = {
          version: 1,
          type: 'animation',
          name: preset.name,
          author: 'CapCut (imported)',
          category: validateAnimationCategory(preset.category),
          description: preset.description ?? `Imported from CapCut ${preset.capcutCategory}`,
          tags: [...preset.tags, 'capcut-import'],
          duration,
          keyframes
        }
        break
      }

      default:
        stats.skipped++
        continue
    }

    // Add Pro flag to description if applicable
    if (preset.isPro) {
      ccPreset.description = (ccPreset.description ?? '') + ' [CapCut Pro]'
      ccPreset.tags = [...(ccPreset.tags ?? []), 'pro']
    }

    // Write .ccpreset file
    const outDir = join(OUT_BASE, subDir)
    mkdirSync(outDir, { recursive: true })

    const fileName = `${preset.id || slugify(preset.name)}.ccpreset`
    const filePath = join(outDir, fileName)
    writeFileSync(filePath, JSON.stringify(ccPreset, null, 2))

    // Track stats
    if (ccType === 'effect') stats.effects++
    else if (ccType === 'transition') stats.transitions++
    else stats.animations++

    manifest.push({
      id: preset.id,
      name: preset.name,
      type: ccType,
      category: ccPreset.category,
      file: `${subDir}/${fileName}`,
      capcutId: preset.capcutId,
      confidence: preset.confidence,
      isPro: preset.isPro
    })
  }

  // Write manifest
  const manifestPath = join(ROOT, 'data', 'output', 'preset-manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalPresets: manifest.length,
    stats,
    presets: manifest.sort((a, b) => a.name.localeCompare(b.name))
  }, null, 2))

  console.log(`\n[convert-to-ccpreset] Done!`)
  console.log(`  Effects:     ${stats.effects}`)
  console.log(`  Transitions: ${stats.transitions}`)
  console.log(`  Animations:  ${stats.animations}`)
  console.log(`  Skipped:     ${stats.skipped}`)
  console.log(`  Manifest:    ${manifestPath}`)
}

convert()
