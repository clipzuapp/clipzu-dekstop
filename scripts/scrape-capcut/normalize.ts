/**
 * Phase 2 — Normalize & Deduplicate
 *
 * Merges data from all Phase 1 sources (web catalog, draft parser, local cache)
 * into a unified intermediate format, deduplicates by name similarity + category,
 * and resolves conflicts (local cache > draft > web catalog).
 *
 * Usage:  npx tsx scripts/scrape-capcut/normalize.ts
 * Input:  data/raw/web-catalog.json, data/raw/draft-*.json, data/raw/local-effects.json
 * Output: data/normalized/capcut-presets.json
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  slugify,
  mapToCapCraftCategory,
  similarity,
  safeReadJson
} from './_shared'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const RAW_DIR = join(ROOT, 'data', 'raw')
const OUT_DIR = join(ROOT, 'data', 'normalized')
const OUT_FILE = join(OUT_DIR, 'capcut-presets.json')

// ---------------------------------------------------------------------------
// Unified preset type
// ---------------------------------------------------------------------------

interface NormalizedPreset {
  id: string                          // stable slug ID
  name: string                        // human-readable name
  presetType: 'effect' | 'transition' | 'filter' | 'text-animation'
  category: string                    // CapCraft-mapped category
  capcutCategory: string              // original CapCut category
  description: string
  tags: string[]
  source: 'web' | 'draft' | 'local' | 'merged'
  confidence: number                  // 0-1, how much data we have
  parameters: NormalizedParameter[]
  keyframes: Record<string, unknown>
  capcutId: string                    // original CapCut effect/filter/transition ID
  thumbnailUrl?: string
  isPro: boolean
}

interface NormalizedParameter {
  name: string
  type: 'number' | 'string' | 'boolean' | 'enum'
  defaultValue: unknown
  min?: number
  max?: number
  enumValues?: string[]
  description?: string
}

// ---------------------------------------------------------------------------
// Input types (from Phase 1 outputs)
// ---------------------------------------------------------------------------

interface WebCatalogEntry {
  name: string
  slug: string
  category: string
  source: string
  url: string
  presetType: 'effect' | 'transition' | 'filter' | 'text-animation'
}

interface WebCatalog {
  scrapedAt: string
  totalEntries: number
  entries: WebCatalogEntry[]
}

interface DraftItems<T> {
  extractedAt: string
  source: string
  items: T[]
}

interface LocalEffectsFile {
  extractedAt: string
  source: string
  scanPaths: string[]
  totalEffects: number
  totalFilters?: number
  totalTransitions?: number
  effects: Array<{
    id: string
    name: string
    category: string
    effectType?: string
    parameters: Array<{ name: string; type: string; defaultValue: unknown; min?: number; max?: number }>
    defaultValues?: Record<string, unknown>
    isPro?: boolean
  }>
  filters?: Array<{
    id: string
    name: string
    category: string
    parameters: Array<{ name: string; type: string; defaultValue: unknown; min?: number; max?: number }>
    defaultValues: Record<string, unknown>
    isPro: boolean
  }>
  transitions?: Array<{
    id: string
    name: string
    category: string
    parameters: Array<{ name: string; type: string; defaultValue: unknown; min?: number; max?: number }>
    defaultValues: Record<string, unknown>
    isPro: boolean
  }>
}

// ---------------------------------------------------------------------------
// Helpers (slugify, similarity, safeReadJson, mapToCapCraftCategory from _shared)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

function normalizeWebCatalog(catalog: WebCatalog | null): NormalizedPreset[] {
  if (!catalog) return []

  return catalog.entries.map((entry) => ({
    id: entry.slug,
    name: entry.name,
    presetType: entry.presetType,
    category: mapToCapCraftCategory(entry.category, entry.presetType),
    capcutCategory: entry.category,
    description: `${entry.presetType} from CapCut web catalog`,
    tags: [entry.presetType, entry.category],
    source: 'web' as const,
    confidence: 0.3, // name + category only
    parameters: [],
    keyframes: {},
    capcutId: entry.slug,
    thumbnailUrl: entry.url,
    isPro: false
  }))
}

function normalizeDraftEffects(draftData: DraftItems<Record<string, unknown>> | null, presetType: 'effect' | 'transition' | 'filter' | 'text-animation'): NormalizedPreset[] {
  if (!draftData) return []

  return draftData.items.map((item) => {
    const name = (item.name ?? item.effect_name ?? item.filter_name ?? 'unknown') as string
    const id = (item.effectId ?? item.filterId ?? item.transitionId ?? item.id ?? slugify(name)) as string
    const rawCategory = (item.category ?? item.type ?? 'unknown') as string

    const params: NormalizedParameter[] = []
    const rawParams = (item.parameters ?? {}) as Record<string, unknown>
    for (const [key, val] of Object.entries(rawParams)) {
      params.push({
        name: key,
        type: typeof val === 'number' ? 'number' : typeof val === 'string' ? 'string' : typeof val === 'boolean' ? 'boolean' : 'string',
        defaultValue: val
      })
    }

    return {
      id: slugify(name) || slugify(id),
      name,
      presetType,
      category: mapToCapCraftCategory(rawCategory, presetType),
      capcutCategory: rawCategory,
      description: `${presetType} extracted from CapCut draft`,
      tags: [presetType, rawCategory],
      source: 'draft' as const,
      confidence: 0.7, // has parameter data
      parameters: params,
      keyframes: (item.keyframes ?? {}) as Record<string, unknown>,
      capcutId: String(id),
      isPro: false
    }
  })
}

function normalizeLocalEffects(local: LocalEffectsFile | null): NormalizedPreset[] {
  if (!local) return []

  const results: NormalizedPreset[] = []

  const processItems = (
    items: Array<{ id: string; name: string; category: string; parameters: Array<{ name: string; type: string; defaultValue: unknown; min?: number; max?: number }>; defaultValues?: Record<string, unknown>; isPro?: boolean }>,
    presetType: 'effect' | 'filter' | 'transition'
  ): void => {
    for (const item of items) {
      const params: NormalizedParameter[] = item.parameters.map(p => ({
        name: p.name,
        type: p.type as NormalizedParameter['type'],
        defaultValue: p.defaultValue,
        min: p.min,
        max: p.max
      }))

      results.push({
        id: slugify(item.name) || slugify(item.id),
        name: item.name,
        presetType: presetType === 'filter' ? 'filter' : presetType,
        category: mapToCapCraftCategory(item.category, presetType),
        capcutCategory: item.category,
        description: `${presetType} from CapCut local cache`,
        tags: [presetType, item.category],
        source: 'local' as const,
        // Only entries with actual parameter data are high-confidence.
        // Parameterless entries are internal pipeline configs (e.g. "linear", "rect")
        // with hash-based IDs — not meaningful user-facing presets.
        confidence: params.length > 0 ? 0.9 : 0.4,
        parameters: params,
        keyframes: {},
        capcutId: item.id,
        isPro: item.isPro ?? false
      })
    }
  }

  processItems(local.effects, 'effect')
  if (local.filters) processItems(local.filters, 'filter')
  if (local.transitions) processItems(local.transitions, 'transition')

  return results
}

// ---------------------------------------------------------------------------
// Deduplication & merging
// ---------------------------------------------------------------------------

function deduplicateAndMerge(allPresets: NormalizedPreset[]): NormalizedPreset[] {
  const merged = new Map<string, NormalizedPreset>()

  for (const preset of allPresets) {
    const key = preset.id

    if (!merged.has(key)) {
      merged.set(key, preset)
      continue
    }

    const existing = merged.get(key)!

    // Keep the one with higher confidence, merge data
    if (preset.confidence > existing.confidence) {
      // New preset has more data — use it as base but keep existing metadata
      const mergedPreset: NormalizedPreset = {
        ...preset,
        source: 'merged',
        description: existing.description || preset.description,
        thumbnailUrl: existing.thumbnailUrl ?? preset.thumbnailUrl,
        tags: [...new Set([...existing.tags, ...preset.tags])]
      }
      merged.set(key, mergedPreset)
    } else {
      // Existing has more data — enrich it with new info
      existing.source = 'merged'
      if (!existing.thumbnailUrl && preset.thumbnailUrl) {
        existing.thumbnailUrl = preset.thumbnailUrl
      }
      existing.tags = [...new Set([...existing.tags, ...preset.tags])]

      // Fill in parameters if existing has none
      if (existing.parameters.length === 0 && preset.parameters.length > 0) {
        existing.parameters = preset.parameters
        existing.confidence = Math.min(1, existing.confidence + 0.2)
      }

      // Fill in keyframes if existing has none
      if (Object.keys(existing.keyframes).length === 0 && Object.keys(preset.keyframes).length > 0) {
        existing.keyframes = preset.keyframes
      }
    }
  }

  // Also fuzzy-deduplicate entries with very similar names in the same category
  const entries = [...merged.values()]
  const finalEntries: NormalizedPreset[] = []
  const removed = new Set<string>()

  for (let i = 0; i < entries.length; i++) {
    if (removed.has(entries[i].id)) continue

    for (let j = i + 1; j < entries.length; j++) {
      if (removed.has(entries[j].id)) continue
      if (entries[i].presetType !== entries[j].presetType) continue

      const sim = similarity(entries[i].name, entries[j].name)
      if (sim > 0.85) {
        // Keep the higher-confidence one
        const [keep, drop] = entries[i].confidence >= entries[j].confidence
          ? [entries[i], entries[j]]
          : [entries[j], entries[i]]

        keep.source = 'merged'
        keep.tags = [...new Set([...keep.tags, ...drop.tags])]
        removed.add(drop.id)
      }
    }
  }

  for (const entry of entries) {
    if (!removed.has(entry.id)) {
      finalEntries.push(entry)
    }
  }

  return finalEntries
}

// ---------------------------------------------------------------------------
// Curated catalog input type
// ---------------------------------------------------------------------------

interface CuratedEntry {
  name: string
  slug: string
  presetType: 'effect' | 'transition' | 'filter' | 'text-animation'
  category: string
  description: string
  tags: string[]
  typicalParams?: Record<string, { type: string; default: number | string; min?: number; max?: number }>
}

interface CuratedCatalog {
  generatedAt: string
  source: string
  totalEntries: number
  entries: CuratedEntry[]
}

function normalizeCuratedCatalog(catalog: CuratedCatalog | null): NormalizedPreset[] {
  if (!catalog) return []

  return catalog.entries.map((entry) => {
    const params: NormalizedParameter[] = []
    if (entry.typicalParams) {
      for (const [name, spec] of Object.entries(entry.typicalParams)) {
        params.push({
          name,
          type: spec.type as NormalizedParameter['type'],
          defaultValue: spec.default,
          min: spec.min,
          max: spec.max
        })
      }
    }

    return {
      id: entry.slug,
      name: entry.name,
      presetType: entry.presetType,
      category: mapToCapCraftCategory(entry.category, entry.presetType),
      capcutCategory: entry.category,
      description: entry.description,
      tags: [...entry.tags, 'curated'],
      source: 'local' as const, // highest confidence
      confidence: 1.0, // curated = highest quality
      parameters: params,
      keyframes: {},
      capcutId: entry.slug,
      isPro: false
    }
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function normalize(): void {
  console.log('[normalize] Starting normalization...\n')

  // Load all sources
  const webCatalog = safeReadJson<WebCatalog>(join(RAW_DIR, 'web-catalog.json'))
  const draftEffects = safeReadJson<DraftItems<Record<string, unknown>>>(join(RAW_DIR, 'draft-effects.json'))
  const draftTransitions = safeReadJson<DraftItems<Record<string, unknown>>>(join(RAW_DIR, 'draft-transitions.json'))
  const draftFilters = safeReadJson<DraftItems<Record<string, unknown>>>(join(RAW_DIR, 'draft-filters.json'))
  const draftAnimations = safeReadJson<DraftItems<Record<string, unknown>>>(join(RAW_DIR, 'draft-animations.json'))
  const localEffects = safeReadJson<LocalEffectsFile>(join(RAW_DIR, 'local-effects.json'))
  const curatedCatalog = safeReadJson<CuratedCatalog>(join(RAW_DIR, 'curated-catalog.json'))

  // Log source availability
  console.log('  Sources:')
  console.log(`    Web catalog:    ${webCatalog ? `${webCatalog.totalEntries} entries` : 'not found'}`)
  console.log(`    Draft effects:  ${draftEffects ? `${draftEffects.items.length} items` : 'not found'}`)
  console.log(`    Draft trans:    ${draftTransitions ? `${draftTransitions.items.length} items` : 'not found'}`)
  console.log(`    Draft filters:  ${draftFilters ? `${draftFilters.items.length} items` : 'not found'}`)
  console.log(`    Draft anims:    ${draftAnimations ? `${draftAnimations.items.length} items` : 'not found'}`)
  console.log(`    Local cache:    ${localEffects ? `${localEffects.totalEffects + (localEffects.totalFilters ?? 0) + (localEffects.totalTransitions ?? 0)} items` : 'not found'}`)
  console.log(`    Curated catalog: ${curatedCatalog ? `${curatedCatalog.totalEntries} entries` : 'not found'}`)

  // Normalize each source
  const allPresets: NormalizedPreset[] = [
    ...normalizeCuratedCatalog(curatedCatalog),
    ...normalizeWebCatalog(webCatalog),
    ...normalizeDraftEffects(draftEffects, 'effect'),
    ...normalizeDraftEffects(draftTransitions, 'transition'),
    ...normalizeDraftEffects(draftFilters, 'filter'),
    ...normalizeDraftEffects(draftAnimations, 'text-animation'),
    ...normalizeLocalEffects(localEffects)
  ]

  console.log(`\n  Total before dedup: ${allPresets.length}`)

  // Deduplicate and merge
  const merged = deduplicateAndMerge(allPresets)

  console.log(`  Total after dedup:  ${merged.length}`)

  // Quality filter: drop web-only entries with no parameters (confidence 0.3).
  // These are mostly user-generated template names scraped from explore pages,
  // not real built-in effects. Keep entries with confidence >= 0.5.
  const MIN_CONFIDENCE = 0.5
  const final = merged.filter(p => p.confidence >= MIN_CONFIDENCE)
  const dropped = merged.length - final.length
  if (dropped > 0) {
    console.log(`  Quality filter:   dropped ${dropped} low-confidence entries (< ${MIN_CONFIDENCE})`)
  }
  console.log(`  Total after filter: ${final.length}`)

  // Sort by type then name
  final.sort((a, b) => {
    if (a.presetType !== b.presetType) return a.presetType.localeCompare(b.presetType)
    return a.name.localeCompare(b.name)
  })

  // Write output
  mkdirSync(OUT_DIR, { recursive: true })

  const output = {
    normalizedAt: new Date().toISOString(),
    totalPresets: final.length,
    summary: {
      effects: final.filter(p => p.presetType === 'effect').length,
      transitions: final.filter(p => p.presetType === 'transition').length,
      filters: final.filter(p => p.presetType === 'filter').length,
      textAnimations: final.filter(p => p.presetType === 'text-animation').length,
      bySource: {
        web: final.filter(p => p.source === 'web').length,
        draft: final.filter(p => p.source === 'draft').length,
        local: final.filter(p => p.source === 'local').length,
        merged: final.filter(p => p.source === 'merged').length
      }
    },
    presets: final
  }

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2))

  console.log(`\n[normalize] Done! Output: ${OUT_FILE}`)
  console.log(`  Effects:        ${output.summary.effects}`)
  console.log(`  Transitions:    ${output.summary.transitions}`)
  console.log(`  Filters:        ${output.summary.filters}`)
  console.log(`  Text Animations: ${output.summary.textAnimations}`)
}

normalize()
