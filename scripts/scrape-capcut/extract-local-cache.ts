/**
 * Phase 1c — CapCut Local App Data Extractor
 *
 * Scans CapCut's already-extracted effect cache directories for config.json
 * files and extracts effect metadata (names, types, categories).
 *
 * CapCut stores effects as pre-extracted directories (not ZIPs) at:
 *   %LOCALAPPDATA%/CapCut/User Data/Cache/effect/{category_id}/{hash}/
 * Each directory has a config.json with effect type/name info.
 *
 * Usage:  npx tsx scripts/scrape-capcut/extract-local-cache.ts
 * Output: data/raw/local-effects.json
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const OUT_DIR = join(ROOT, 'data', 'raw')
const OUT_FILE = join(OUT_DIR, 'local-effects.json')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EffectConfig {
  id: string
  name: string
  category: string
  effectType: string
  version: string
  hasParameters: boolean
  parameters: EffectParameter[]
  source: string
}

interface EffectParameter {
  name: string
  type: 'number' | 'string' | 'boolean'
  defaultValue: unknown
}

interface ExtractResult {
  extractedAt: string
  source: string
  scanPaths: string[]
  totalEffects: number
  effects: EffectConfig[]
}

// ---------------------------------------------------------------------------
// Path discovery
// ---------------------------------------------------------------------------

function getCacheBasePaths(): string[] {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return []

  return [
    join(localAppData, 'CapCut', 'User Data', 'Cache'),
    join(localAppData, 'CapCut', 'Cache'),
  ].filter(p => existsSync(p))
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function parseConfigJson(data: Record<string, unknown>, source: string, effectDirName: string): EffectConfig | null {
  const name = (data['name'] ?? effectDirName) as string
  if (!name) return null

  // Extract effect type from Link array
  let effectType = 'unknown'
  const effect = data['effect'] as Record<string, unknown> | undefined
  if (effect?.['Link'] && Array.isArray(effect['Link'])) {
    const links = effect['Link'] as Array<Record<string, unknown>>
    if (links.length > 0) {
      effectType = (links[0]['type'] ?? 'unknown') as string
    }
  }

  // Try to find parameters in nested content.json or scene.config
  const parameters: EffectParameter[] = []

  // Check if there's a scene.config with parameter data
  const sourceDir = dirname(source)
  const sceneConfigPath = join(sourceDir, 'scene.config')
  if (existsSync(sceneConfigPath)) {
    try {
      const sceneContent = readFileSync(sceneConfigPath, 'utf-8')
      // scene.config might be JSON or a custom format
      if (sceneContent.trim().startsWith('{')) {
        const sceneData = JSON.parse(sceneContent) as Record<string, unknown>
        extractParamsFromObject(sceneData, parameters)
      }
    } catch (err) {
      console.warn(`    Warning: Could not parse scene.config at ${sceneConfigPath}: ${(err as Error).message}`)
    }
  }

  return {
    id: effectDirName,
    name,
    category: dirname(source).split(/[/\\]/).slice(-2, -1)[0] ?? 'unknown',
    effectType,
    version: (data['version'] ?? '') as string,
    hasParameters: parameters.length > 0,
    parameters,
    source
  }
}

function extractParamsFromObject(obj: Record<string, unknown>, params: EffectParameter[]): void {
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'number') {
      params.push({ name: key, type: 'number', defaultValue: val })
    } else if (typeof val === 'boolean') {
      params.push({ name: key, type: 'boolean', defaultValue: val })
    } else if (typeof val === 'string' && val.length < 100) {
      params.push({ name: key, type: 'string', defaultValue: val })
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function extract(): void {
  console.log('[extract-local-cache] Starting CapCut local cache extraction...\n')

  const basePaths = getCacheBasePaths()

  if (basePaths.length === 0) {
    console.log('  No CapCut cache directories found.')
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(OUT_FILE, JSON.stringify({
      extractedAt: new Date().toISOString(), source: 'none', scanPaths: [],
      totalEffects: 0, effects: []
    }, null, 2))
    return
  }

  const effects: EffectConfig[] = []
  const scanPaths: string[] = []

  for (const basePath of basePaths) {
    console.log(`  Scanning: ${basePath}`)
    scanPaths.push(basePath)

    const effectDir = join(basePath, 'effect')
    if (!existsSync(effectDir)) {
      console.log('    No effect directory found')
      continue
    }

    // Each subdirectory is a category_id
    const categoryDirs = readdirSync(effectDir, { withFileTypes: true })
      .filter(d => d.isDirectory())

    console.log(`    Effect categories: ${categoryDirs.length}`)

    for (const catDir of categoryDirs) {
      const catPath = join(effectDir, catDir.name)

      // Each subdirectory within category is a hash/effect_id
      const effectDirs = readdirSync(catPath, { withFileTypes: true })
        .filter(d => d.isDirectory())

      for (const effDir of effectDirs) {
        const effPath = join(catPath, effDir.name)
        const configPath = join(effPath, 'config.json')

        if (!existsSync(configPath)) continue

        try {
          const configData = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
          const parsed = parseConfigJson(configData, configPath, effDir.name)
          if (parsed) {
            effects.push(parsed)
          }
        } catch (err) {
          console.warn(`    Warning: Could not parse ${configPath}: ${(err as Error).message}`)
        }
      }
    }
  }

  // Deduplicate by ID
  const seen = new Map<string, EffectConfig>()
  for (const item of effects) {
    if (!seen.has(item.id)) seen.set(item.id, item)
  }
  const deduped = [...seen.values()]

  const result: ExtractResult = {
    extractedAt: new Date().toISOString(),
    source: `${basePaths.length} cache path(s)`,
    scanPaths,
    totalEffects: deduped.length,
    effects: deduped
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(result, null, 2))

  console.log(`\n[extract-local-cache] Done!`)
  console.log(`  Effects: ${result.totalEffects}`)
  console.log(`  Output: ${OUT_FILE}`)

  // Summary by effect type
  const byType: Record<string, number> = {}
  for (const e of deduped) {
    byType[e.effectType] = (byType[e.effectType] ?? 0) + 1
  }
  console.log('\n  Effect types:')
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`)
  }
}

extract()
