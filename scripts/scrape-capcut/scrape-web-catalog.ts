/**
 * Phase 1a — CapCut Web Catalog Scraper
 *
 * Scrapes CapCut's public explore pages for effect, transition, filter,
 * and text-animation names + categories.  Uses only Node built-ins (fetch).
 *
 * Usage:  npx tsx scripts/scrape-capcut/scrape-web-catalog.ts
 * Output: data/raw/web-catalog.json
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { slugify, deriveCategoryFromSlug } from './_shared'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const OUT_DIR = join(ROOT, 'data', 'raw')
const OUT_FILE = join(OUT_DIR, 'web-catalog.json')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CatalogEntry {
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
  entries: CatalogEntry[]
}

// ---------------------------------------------------------------------------
// Explore page targets
// ---------------------------------------------------------------------------

const EXPLORE_PAGES: Array<{
  url: string
  presetType: CatalogEntry['presetType']
  category: string
}> = [
  // Effects
  { url: 'https://www.capcut.com/explore/effects-presets', presetType: 'effect', category: 'effects-presets' },
  { url: 'https://www.capcut.com/explore/Video-effects', presetType: 'effect', category: 'video-effects' },
  { url: 'https://www.capcut.com/explore/face-blur-effect', presetType: 'effect', category: 'face-blur' },
  { url: 'https://www.capcut.com/explore/glow-effect', presetType: 'effect', category: 'glow' },
  { url: 'https://www.capcut.com/explore/fire-effect', presetType: 'effect', category: 'fire' },
  { url: 'https://www.capcut.com/explore/Motion-blur-effect', presetType: 'effect', category: 'motion-blur' },
  { url: 'https://www.capcut.com/explore/Zoom-Effect', presetType: 'effect', category: 'zoom' },
  { url: 'https://www.capcut.com/explore/3D-ZOOM', presetType: 'effect', category: '3d-zoom' },
  { url: 'https://www.capcut.com/explore/3d-special-effects/7497637528247371793', presetType: 'effect', category: '3d-special' },
  { url: 'https://www.capcut.com/explore/light-effects', presetType: 'effect', category: 'light' },
  { url: 'https://www.capcut.com/explore/vfx-design/7497635034758006800', presetType: 'effect', category: 'vfx' },
  { url: 'https://www.capcut.com/explore/motion-trail-effect/7497634004175816720', presetType: 'effect', category: 'motion-trail' },
  { url: 'https://www.capcut.com/explore/eye-blink-effect', presetType: 'effect', category: 'eye-blink' },
  { url: 'https://www.capcut.com/explore/aura-edit', presetType: 'effect', category: 'aura' },
  { url: 'https://www.capcut.com/explore/ai-effect-capcut-template/7497636498314184705', presetType: 'effect', category: 'ai-effect' },
  { url: 'https://www.capcut.com/explore/Special-effects-template/7497624216624334865', presetType: 'effect', category: 'special-effects' },
  { url: 'https://www.capcut.com/explore/freeze-frame-animation/7497633659706181633', presetType: 'effect', category: 'freeze-frame' },
  { url: 'https://www.capcut.com/explore/chroma-key-editing/7497653593894291472', presetType: 'effect', category: 'chroma-key' },
  { url: 'https://www.capcut.com/explore/age-template-effect', presetType: 'effect', category: 'age-effect' },

  // Transitions
  { url: 'https://www.capcut.com/explore/transitions-for-CapCut', presetType: 'transition', category: 'transitions' },
  { url: 'https://www.capcut.com/explore/face-transition-effect/7497633747187288080', presetType: 'transition', category: 'face-transition' },

  // Filters
  { url: 'https://www.capcut.com/explore/4k-filter', presetType: 'filter', category: '4k-filter' },
  { url: 'https://www.capcut.com/explore/Color-grading-template/7497624216624416785', presetType: 'filter', category: 'color-grading' },
  { url: 'https://www.capcut.com/explore/lofi-dust-filter', presetType: 'filter', category: 'lofi-dust' },
  { url: 'https://www.capcut.com/explore/background-blur', presetType: 'filter', category: 'background-blur' },
  { url: 'https://www.capcut.com/explore/ai-filter-new2026', presetType: 'filter', category: 'ai-filter' },

  // Text animations
  { url: 'https://www.capcut.com/explore/3d-text-animation/7497636068079912976', presetType: 'text-animation', category: '3d-text' },
]

// ---------------------------------------------------------------------------
// Helpers (slugify, deriveCategoryFromSlug from _shared)
// ---------------------------------------------------------------------------

/** Strip HTML tags and decode entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** Extract entries from CapCut explore page HTML using <a> tag patterns. */
function extractEntries(html: string, sourceUrl: string, presetType: CatalogEntry['presetType'], defaultCategory: string): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  const seen = new Set<string>()

  // Pattern 1: Explore sub-page links  <a href=".../explore/slug/id">Name</a>
  const exploreAnchorRe = /<a[^>]*href="(https:\/\/www\.capcut\.com\/explore\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null

  while ((m = exploreAnchorRe.exec(html)) !== null) {
    const url = m[1]
    const slugPath = m[2]
    const rawText = stripHtml(m[3])

    // Skip empty or nav-only text
    if (!rawText || rawText.length < 2) continue
    // Skip pagination / filter links
    if (slugPath.includes('?') || slugPath === defaultCategory) continue

    const slug = slugPath.replace(/\/[^/]+$/, '').replace(/\//g, '-') // strip trailing ID
    const key = slugify(rawText)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const category = deriveCategoryFromSlug(slug, defaultCategory, presetType)

    entries.push({
      name: rawText,
      slug: key,
      category,
      source: sourceUrl,
      url,
      presetType
    })
  }

  // Pattern 2: Template detail links  <a href=".../template-detail/...">Name</a>
  const templateAnchorRe = /<a[^>]*href="(https:\/\/www\.capcut\.com\/template-detail\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/gi
  while ((m = templateAnchorRe.exec(html)) !== null) {
    const url = m[1]
    const rawText = stripHtml(m[3])

    // Skip view counts (e.g. "9.9M", "549.8K")
    if (!rawText || /^[\d.]+[KMB]?$/.test(rawText.trim())) continue
    // Skip very short or empty
    if (rawText.length < 2) continue

    const key = slugify(rawText)
    if (!key || seen.has(key)) continue
    seen.add(key)

    entries.push({
      name: rawText,
      slug: key,
      category: defaultCategory,
      source: sourceUrl,
      url,
      presetType
    })
  }

  // Pattern 3: Embedded "name" fields from SSR JSON data
  const nameFieldRe = /"name"\s*:\s*"([^"]+)"/g
  while ((m = nameFieldRe.exec(html)) !== null) {
    const rawName = m[1].trim()
    if (rawName.length < 3) continue
    // Skip author names (typically short, contain special chars, or are usernames)
    if (/^[\p{L}\p{N}]{1,15}$/u.test(rawName) && !rawName.includes(' ')) continue

    const key = slugify(rawName)
    if (!key || seen.has(key)) continue
    seen.add(key)

    entries.push({
      name: rawName,
      slug: key,
      category: defaultCategory,
      source: sourceUrl,
      url: sourceUrl,
      presetType
    })
  }

  return entries
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function scrape(): Promise<void> {
  console.log('[scrape-web-catalog] Starting CapCut web catalog scrape...\n')

  const allEntries: CatalogEntry[] = []

  for (const target of EXPLORE_PAGES) {
    try {
      console.log(`  Fetching: ${target.url}`)
      const res = await fetch(target.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      })

      if (!res.ok) {
        console.warn(`    HTTP ${res.status} — skipping`)
        continue
      }

      const html = await res.text()
      const entries = extractEntries(html, target.url, target.presetType, target.category)
      console.log(`    Found ${entries.length} entries`)
      allEntries.push(...entries)

      // Be polite — small delay between requests
      await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.warn(`    Error: ${(err as Error).message}`)
    }
  }

  // Deduplicate globally by slug + type
  const seen = new Map<string, CatalogEntry>()
  for (const entry of allEntries) {
    const key = `${entry.slug}::${entry.presetType}`
    if (!seen.has(key)) {
      seen.set(key, entry)
    }
  }

  const deduped = [...seen.values()]

  const catalog: WebCatalog = {
    scrapedAt: new Date().toISOString(),
    totalEntries: deduped.length,
    entries: deduped.sort((a, b) => a.name.localeCompare(b.name))
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(catalog, null, 2), 'utf-8')

  console.log(`\n[scrape-web-catalog] Done! ${deduped.length} entries -> ${OUT_FILE}`)

  // Summary by type
  const byType: Record<string, number> = {}
  for (const e of deduped) {
    byType[e.presetType] = (byType[e.presetType] ?? 0) + 1
  }
  console.log('\n  Summary by type:')
  for (const [type, count] of Object.entries(byType).sort()) {
    console.log(`    ${type}: ${count}`)
  }
}

scrape().catch(console.error)
