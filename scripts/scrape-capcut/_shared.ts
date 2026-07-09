/**
 * Shared utilities for the scrape-capcut pipeline.
 *
 * SSOT for slugify, category mapping, and other common helpers
 * used across multiple pipeline scripts.
 */

// ---------------------------------------------------------------------------
// Slugify
// ---------------------------------------------------------------------------

/** Convert a preset name to a URL/filesystem-safe slug ID. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// ---------------------------------------------------------------------------
// CapCraft category sets
// ---------------------------------------------------------------------------

export const EFFECT_CATEGORIES = new Set([
  'blur', 'glow', 'camera', 'color', 'distortion', 'style', 'noise', 'utility'
])

export const TRANSITION_CATEGORIES = new Set([
  'dissolve', 'slide', 'wipe', 'zoom', 'blur', 'light'
])

export const ANIMATION_CATEGORIES = new Set([
  'entrance', 'exit', 'emphasis', 'text', 'motion'
])

// ---------------------------------------------------------------------------
// Category validation — ensure category is valid for CapCraft
// ---------------------------------------------------------------------------

export function validateEffectCategory(cat: string): string {
  return EFFECT_CATEGORIES.has(cat) ? cat : 'utility'
}

export function validateTransitionCategory(cat: string): string {
  return TRANSITION_CATEGORIES.has(cat) ? cat : 'dissolve'
}

export function validateAnimationCategory(cat: string): string {
  return ANIMATION_CATEGORIES.has(cat) ? cat : 'motion'
}

// ---------------------------------------------------------------------------
// Category mapping — map raw CapCut category strings to CapCraft categories
// ---------------------------------------------------------------------------

export function mapToCapCraftCategory(raw: string, presetType: string): string {
  const r = raw.toLowerCase()

  if (presetType === 'effect') {
    if (r.includes('blur')) return 'blur'
    if (r.includes('glow') || r.includes('light') || r.includes('aura')) return 'glow'
    if (r.includes('camera') || r.includes('zoom') || r.includes('3d') || r.includes('shake')) return 'camera'
    if (r.includes('color') || r.includes('grade') || r.includes('tone')) return 'color'
    if (r.includes('distort') || r.includes('glitch') || r.includes('warp')) return 'distortion'
    if (r.includes('noise') || r.includes('grain') || r.includes('dust')) return 'noise'
    if (r.includes('style') || r.includes('vintage') || r.includes('film') || r.includes('retro') || r.includes('vfx')) return 'style'
    return 'utility'
  }

  if (presetType === 'transition') {
    if (r.includes('dissolve') || r.includes('fade') || r.includes('blend')) return 'dissolve'
    if (r.includes('slide') || r.includes('push') || r.includes('slip')) return 'slide'
    if (r.includes('wipe') || r.includes('curtain')) return 'wipe'
    if (r.includes('zoom') || r.includes('scale')) return 'zoom'
    if (r.includes('blur')) return 'blur'
    if (r.includes('light') || r.includes('flash') || r.includes('glow')) return 'light'
    return 'dissolve'
  }

  if (presetType === 'filter') {
    if (r.includes('blur')) return 'blur'
    if (r.includes('color') || r.includes('grade') || r.includes('lut')) return 'color'
    if (r.includes('enhance') || r.includes('4k') || r.includes('hd') || r.includes('sharp')) return 'enhancement'
    if (r.includes('ai')) return 'ai'
    if (r.includes('vintage') || r.includes('film') || r.includes('retro') || r.includes('lofi')) return 'style'
    return 'color'
  }

  if (presetType === 'text-animation') {
    if (r.includes('entrance') || r.includes('in')) return 'entrance'
    if (r.includes('exit') || r.includes('out')) return 'exit'
    if (r.includes('emphasis') || r.includes('bounce') || r.includes('pulse')) return 'emphasis'
    if (r.includes('text') || r.includes('typewriter') || r.includes('karaoke')) return 'text'
    return 'motion'
  }

  return 'utility'
}

/**
 * Derive a CapCraft-friendly category from a CapCut slug path.
 * Used by the web scraper for initial categorization.
 */
export function deriveCategoryFromSlug(slug: string, fallback: string, presetType: string): string {
  const s = slug.toLowerCase()

  if (presetType === 'effect') {
    if (s.includes('blur') || s.includes('background-blur')) return 'blur'
    if (s.includes('glow') || s.includes('aura')) return 'glow'
    if (s.includes('zoom') || s.includes('3d')) return 'camera'
    if (s.includes('color') || s.includes('grading')) return 'color'
    if (s.includes('distort') || s.includes('glitch')) return 'distortion'
    if (s.includes('fire') || s.includes('light') || s.includes('vfx')) return 'style'
    if (s.includes('noise') || s.includes('grain') || s.includes('dust')) return 'noise'
    if (s.includes('ai') || s.includes('face') || s.includes('eye') || s.includes('age')) return 'ai'
    if (s.includes('motion') || s.includes('trail') || s.includes('freeze')) return 'motion'
    if (s.includes('chroma') || s.includes('special')) return 'utility'
  }

  if (presetType === 'transition') {
    if (s.includes('face')) return 'face'
    if (s.includes('slide')) return 'slide'
    if (s.includes('wipe')) return 'wipe'
    if (s.includes('zoom')) return 'zoom'
    if (s.includes('blur')) return 'blur'
    if (s.includes('light')) return 'light'
    if (s.includes('dissolve') || s.includes('fade')) return 'dissolve'
  }

  if (presetType === 'filter') {
    if (s.includes('blur')) return 'blur'
    if (s.includes('color') || s.includes('grading')) return 'color'
    if (s.includes('4k') || s.includes('hd')) return 'enhancement'
    if (s.includes('ai')) return 'ai'
    if (s.includes('lofi') || s.includes('dust') || s.includes('vintage')) return 'style'
  }

  if (presetType === 'text-animation') {
    if (s.includes('3d')) return '3d'
    if (s.includes('freeze')) return 'emphasis'
  }

  return fallback
}

// ---------------------------------------------------------------------------
// String similarity (Jaccard on character bigrams)
// ---------------------------------------------------------------------------

/** Simple string similarity (Jaccard on character bigrams). */
export function similarity(a: string, b: string): number {
  const bigramsA = new Set<string>()
  const bigramsB = new Set<string>()
  const al = a.toLowerCase()
  const bl = b.toLowerCase()

  for (let i = 0; i < al.length - 1; i++) bigramsA.add(al.slice(i, i + 2))
  for (let i = 0; i < bl.length - 1; i++) bigramsB.add(bl.slice(i, i + 2))

  if (bigramsA.size === 0 && bigramsB.size === 0) return 1
  let intersection = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++
  }
  return intersection / (bigramsA.size + bigramsB.size - intersection)
}

// ---------------------------------------------------------------------------
// Safe JSON read
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'

export function safeReadJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch (err) {
    console.warn(`  Warning: Could not parse ${filePath}: ${(err as Error).message}`)
    return null
  }
}
