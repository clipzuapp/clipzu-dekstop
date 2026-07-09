/**
 * Phase 1b — CapCut Draft Format Parser
 *
 * Parses a CapCut / JianYing `draft_content.json` file and extracts
 * effects, transitions, filters, and text-animation data with their
 * parameters and keyframes.
 *
 * Usage:  npx tsx scripts/scrape-capcut/parse-draft-format.ts [path-to-draft_content.json]
 * Output: data/raw/draft-effects.json, draft-transitions.json, draft-filters.json, draft-animations.json
 *
 * If no path is given, the script scans the default CapCut drafts directory:
 *   %LOCALAPPDATA%/CapCut/User Data/Projects/com.lveditor.draft/
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const OUT_DIR = join(ROOT, 'data', 'raw')

// ---------------------------------------------------------------------------
// Types — CapCut draft_content.json structures (partial / community-documented)
// ---------------------------------------------------------------------------

interface DraftMaterial {
  id?: string
  type?: string
  name?: string
  path?: string
  // Effect-specific
  effect_id?: string
  effect_name?: string
  category_id?: string
  category_name?: string
  // Filter-specific
  filter_id?: string
  filter_name?: string
  intensity?: number
  // Parameters
  params?: Record<string, unknown>
  value?: unknown
  // Keyframes
  keyframe_graph?: KeyframeGraph
  keyframes?: Record<string, unknown>
  // Time
  start_time?: number
  end_time?: number
  duration?: number
  // Generic catch-all
  [key: string]: unknown
}

interface KeyframeGraph {
  graphs?: Record<string, KeyframeTrack[]>
}

interface KeyframeTrack {
  id?: string
  material_id?: string
  attribute?: string
  keyframe_list?: Array<{ time?: number; value?: number }>
}

interface DraftTrack {
  id?: string
  type?: string
  segments?: DraftSegment[]
}

interface DraftSegment {
  id?: string
  material_id?: string
  type?: string
  target_timerange?: { start: number; duration: number; end: number }
  // Effects applied to this segment
  effects?: string[]   // material IDs
  filters?: string[]
  // Transitions
  transition?: {
    id?: string
    name?: string
    type?: string
    duration?: number
    resource_id?: string
  }
  [key: string]: unknown
}

interface DraftContent {
  id?: string
  name?: string
  materials?: {
    effects?: DraftMaterial[]
    videos?: DraftMaterial[]
    audios?: DraftMaterial[]
    texts?: DraftMaterial[]
    filters?: DraftMaterial[]
    transitions?: DraftMaterial[]
    // JianYing-specific keys
    effect_list?: DraftMaterial[]
    filter_list?: DraftMaterial[]
    [key: string]: unknown
  }
  tracks?: DraftTrack[]
  // JianYing sometimes nests differently
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

interface ExtractedEffect {
  effectId: string
  name: string
  category: string
  source: string
  parameters: Record<string, unknown>
  keyframes: Record<string, unknown>
  hasIntensity: boolean
  raw: DraftMaterial
}

interface ExtractedTransition {
  transitionId: string
  name: string
  type: string
  duration: number
  source: string
  parameters: Record<string, unknown>
  raw: DraftMaterial
}

interface ExtractedFilter {
  filterId: string
  name: string
  category: string
  intensity: number
  source: string
  parameters: Record<string, unknown>
  raw: DraftMaterial
}

interface ExtractedAnimation {
  id: string
  name: string
  type: string
  duration: number
  source: string
  keyframes: Record<string, unknown>
  parameters: Record<string, unknown>
  raw: DraftMaterial
}

// ---------------------------------------------------------------------------
// Extraction logic
// ---------------------------------------------------------------------------

function extractEffects(materials: DraftMaterial[], source: string): ExtractedEffect[] {
  const results: ExtractedEffect[] = []
  const seen = new Set<string>()

  for (const mat of materials) {
    const id = mat.effect_id ?? mat.id ?? ''
    if (!id || seen.has(id)) continue
    seen.add(id)

    results.push({
      effectId: id,
      name: mat.effect_name ?? mat.name ?? `effect_${id}`,
      category: mat.category_name ?? mat.category_id ?? 'unknown',
      source,
      parameters: mat.params ?? extractParams(mat),
      keyframes: extractKeyframes(mat),
      hasIntensity: mat.intensity !== undefined,
      raw: mat
    })
  }

  return results
}

function extractTransitions(materials: DraftMaterial[], source: string): ExtractedTransition[] {
  const results: ExtractedTransition[] = []
  const seen = new Set<string>()

  for (const mat of materials) {
    const id = mat.id ?? ''
    if (!id || seen.has(id)) continue
    seen.add(id)

    results.push({
      transitionId: id,
      name: mat.name ?? `transition_${id}`,
      type: mat.type ?? 'unknown',
      duration: mat.duration ?? 0,
      source,
      parameters: mat.params ?? extractParams(mat),
      raw: mat
    })
  }

  return results
}

function extractFilters(materials: DraftMaterial[], source: string): ExtractedFilter[] {
  const results: ExtractedFilter[] = []
  const seen = new Set<string>()

  for (const mat of materials) {
    const id = mat.filter_id ?? mat.id ?? ''
    if (!id || seen.has(id)) continue
    seen.add(id)

    results.push({
      filterId: id,
      name: mat.filter_name ?? mat.name ?? `filter_${id}`,
      category: mat.category_name ?? mat.category_id ?? 'unknown',
      intensity: mat.intensity ?? 1.0,
      source,
      parameters: mat.params ?? extractParams(mat),
      raw: mat
    })
  }

  return results
}

function extractAnimations(materials: DraftMaterial[], source: string): ExtractedAnimation[] {
  const results: ExtractedAnimation[] = []
  const seen = new Set<string>()

  for (const mat of materials) {
    const id = mat.id ?? ''
    if (!id || seen.has(id)) continue

    // Animations typically have keyframe data or animation-specific type
    const type = mat.type ?? ''
    if (!type.includes('animation') && !mat.keyframe_graph && !mat.keyframes) continue

    seen.add(id)
    results.push({
      id,
      name: mat.name ?? `animation_${id}`,
      type,
      duration: mat.duration ?? 0,
      source,
      keyframes: extractKeyframes(mat),
      parameters: mat.params ?? extractParams(mat),
      raw: mat
    })
  }

  return results
}

/** Extract parameter-like fields from a material object. */
function extractParams(mat: DraftMaterial): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  const SKIP_KEYS = new Set([
    'id', 'type', 'name', 'path', 'effect_id', 'effect_name',
    'category_id', 'category_name', 'filter_id', 'filter_name',
    'intensity', 'params', 'keyframe_graph', 'keyframes',
    'start_time', 'end_time', 'duration', 'value'
  ])

  for (const [key, val] of Object.entries(mat)) {
    if (SKIP_KEYS.has(key)) continue
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      // Nested object — likely a parameter group
      params[key] = val
    } else if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
      params[key] = val
    }
  }

  return params
}

/** Extract keyframe data from a material. */
function extractKeyframes(mat: DraftMaterial): Record<string, unknown> {
  const kf: Record<string, unknown> = {}

  if (mat.keyframe_graph?.graphs) {
    kf.graphs = mat.keyframe_graph.graphs
  }
  if (mat.keyframes) {
    kf.keyframes = mat.keyframes
  }

  return kf
}

// ---------------------------------------------------------------------------
// Draft discovery
// ---------------------------------------------------------------------------

function findDraftFiles(explicitPath?: string): string[] {
  if (explicitPath) {
    return [explicitPath]
  }

  // Default: scan CapCut drafts directory
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) {
    console.warn('  LOCALAPPDATA not set — cannot find CapCut drafts directory')
    return []
  }

  const draftsBase = join(localAppData, 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft')
  if (!existsSync(draftsBase)) {
    console.warn(`  Drafts directory not found: ${draftsBase}`)
    console.warn('  Tip: provide an explicit path to a draft_content.json file')
    return []
  }

  const files: string[] = []
  const dirs = readdirSync(draftsBase, { withFileTypes: true })

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const draftFile = join(draftsBase, dir.name, 'draft_content.json')
    if (existsSync(draftFile)) {
      files.push(draftFile)
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function parse(inputPath?: string): Promise<void> {
  console.log('[parse-draft-format] Starting CapCut draft parser...\n')

  const draftFiles = findDraftFiles(inputPath)

  if (draftFiles.length === 0) {
    console.log('  No draft files found. Creating empty output files.')
    mkdirSync(OUT_DIR, { recursive: true })
    const empty = { extractedAt: new Date().toISOString(), source: 'none', items: [] }
    writeFileSync(join(OUT_DIR, 'draft-effects.json'), JSON.stringify(empty, null, 2))
    writeFileSync(join(OUT_DIR, 'draft-transitions.json'), JSON.stringify(empty, null, 2))
    writeFileSync(join(OUT_DIR, 'draft-filters.json'), JSON.stringify(empty, null, 2))
    writeFileSync(join(OUT_DIR, 'draft-animations.json'), JSON.stringify(empty, null, 2))
    return
  }

  const allEffects: ExtractedEffect[] = []
  const allTransitions: ExtractedTransition[] = []
  const allFilters: ExtractedFilter[] = []
  const allAnimations: ExtractedAnimation[] = []

  for (const filePath of draftFiles) {
    console.log(`  Parsing: ${filePath}`)

    try {
      const raw = readFileSync(filePath, 'utf-8')
      const draft: DraftContent = JSON.parse(raw)
      const materials = draft.materials ?? {}

      // Collect from all material arrays
      const effectSources = [
        ...(materials.effects ?? []),
        ...(materials.effect_list ?? []),
      ]
      const filterSources = [
        ...(materials.filters ?? []),
        ...(materials.filter_list ?? []),
      ]
      const transitionSources = materials.transitions ?? []

      // Also scan tracks for inline transitions
      if (draft.tracks) {
        for (const track of draft.tracks) {
          if (!track.segments) continue
          for (const seg of track.segments) {
            if (seg.transition) {
              transitionSources.push({
                id: seg.transition.id,
                name: seg.transition.name,
                type: seg.transition.type,
                duration: seg.transition.duration
              } as DraftMaterial)
            }
          }
        }
      }

      // Extract from all known material categories
      const effects = extractEffects(effectSources, filePath)
      const transitions = extractTransitions(transitionSources, filePath)
      const filters = extractFilters(filterSources, filePath)

      // Animations may be in various material arrays
      const animSources = [
        ...(materials.texts ?? []),
        ...(materials.videos ?? []),
      ]
      const animations = extractAnimations(animSources, filePath)

      console.log(`    Effects: ${effects.length}, Transitions: ${transitions.length}, Filters: ${filters.length}, Animations: ${animations.length}`)

      allEffects.push(...effects)
      allTransitions.push(...transitions)
      allFilters.push(...filters)
      allAnimations.push(...animations)
    } catch (err) {
      console.warn(`    Error parsing ${filePath}: ${(err as Error).message}`)
    }
  }

  // Write outputs
  mkdirSync(OUT_DIR, { recursive: true })
  const ts = new Date().toISOString()

  writeFileSync(join(OUT_DIR, 'draft-effects.json'), JSON.stringify({
    extractedAt: ts, source: `${draftFiles.length} draft(s)`, items: allEffects
  }, null, 2))

  writeFileSync(join(OUT_DIR, 'draft-transitions.json'), JSON.stringify({
    extractedAt: ts, source: `${draftFiles.length} draft(s)`, items: allTransitions
  }, null, 2))

  writeFileSync(join(OUT_DIR, 'draft-filters.json'), JSON.stringify({
    extractedAt: ts, source: `${draftFiles.length} draft(s)`, items: allFilters
  }, null, 2))

  writeFileSync(join(OUT_DIR, 'draft-animations.json'), JSON.stringify({
    extractedAt: ts, source: `${draftFiles.length} draft(s)`, items: allAnimations
  }, null, 2))

  console.log(`\n[parse-draft-format] Done!`)
  console.log(`  Effects:     ${allEffects.length}`)
  console.log(`  Transitions: ${allTransitions.length}`)
  console.log(`  Filters:     ${allFilters.length}`)
  console.log(`  Animations:  ${allAnimations.length}`)
}

// CLI: optional path argument
const argPath = process.argv[2]
parse(argPath).catch(console.error)
