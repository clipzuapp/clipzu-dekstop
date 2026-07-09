// ---------------------------------------------------------------------------
// FilterPipeline — Modifier[] → CSS filter string
// ---------------------------------------------------------------------------
//
// Converts a clip's modifier stack into a CSS `filter` string for the
// <video> element. GPU-accelerated by the browser compositor.
//
// SSOT: This is the only file that maps effect IDs to CSS filter functions.
// Used by Preview (playback) and Export (when generating ffmpeg filters).

import type { Modifier } from '../effects/types/Modifier'
import type { EffectRegistry } from '../effects/core/EffectRegistry'

/**
 * Map from effect ID to a function that converts the modifier's parameter
 * value into a CSS filter fragment.
 *
 * Each function receives the modifier's parameters record and returns
 * a CSS filter string fragment (e.g. "blur(10px)") or empty string if disabled.
 */
type CssFilterMapper = (params: Record<string, number | string | boolean>) => string

const FILTER_MAPPERS: Record<string, CssFilterMapper> = {
  'blur': (p) => {
    const amount = typeof p['amount'] === 'number' ? p['amount'] : 0
    return amount > 0 ? `blur(${amount}px)` : ''
  },
  'brightness': (p) => {
    const level = typeof p['level'] === 'number' ? p['level'] : 0
    // -100..100 → 0..2 (CSS brightness multiplier, 1 = normal)
    const value = 1 + level / 100
    return value !== 1 ? `brightness(${value})` : ''
  },
  'contrast': (p) => {
    const level = typeof p['level'] === 'number' ? p['level'] : 0
    const value = 1 + level / 100
    return value !== 1 ? `contrast(${value})` : ''
  },
  'saturation': (p) => {
    const level = typeof p['level'] === 'number' ? p['level'] : 0
    const value = 1 + level / 100
    return value !== 1 ? `saturate(${value})` : ''
  },
  'exposure': (p) => {
    const level = typeof p['level'] === 'number' ? p['level'] : 0
    // Exposure maps to brightness (same CSS function, different semantic)
    const value = 1 + level / 100
    return value !== 1 ? `brightness(${value})` : ''
  },
  'hue-rotate': (p) => {
    const angle = typeof p['angle'] === 'number' ? p['angle'] : 0
    return angle !== 0 ? `hue-rotate(${angle}deg)` : ''
  },
  'sepia': (p) => {
    const amount = typeof p['amount'] === 'number' ? p['amount'] : 0
    return amount > 0 ? `sepia(${amount}%)` : ''
  },
  'grayscale': (p) => {
    const amount = typeof p['amount'] === 'number' ? p['amount'] : 0
    return amount > 0 ? `grayscale(${amount}%)` : ''
  },
  'invert': (p) => {
    const amount = typeof p['amount'] === 'number' ? p['amount'] : 0
    return amount > 0 ? `invert(${amount}%)` : ''
  },
  // 'sharpen' has no CSS equivalent — requires canvas convolution (V2)
}

/**
 * Build a CSS `filter` string from a clip's modifier stack.
 *
 * Only enabled modifiers with a known CSS mapping are included.
 * Unknown effect IDs are silently skipped (they may be canvas-based V2 effects).
 *
 * @param modifiers — The clip's modifier array (may be undefined).
 * @param _registry — Effect registry for future use (parameter metadata).
 * @returns CSS filter string, or empty string if no filters apply.
 */
export function buildCssFilter(
  modifiers: Modifier[] | undefined,
  _registry?: EffectRegistry
): string {
  if (!modifiers || modifiers.length === 0) return ''

  const fragments: string[] = []
  for (const mod of modifiers) {
    if (!mod.enabled) continue
    const mapper = FILTER_MAPPERS[mod.presetId]
    if (!mapper) continue
    const fragment = mapper(mod.parameters)
    if (fragment) fragments.push(fragment)
  }

  return fragments.join(' ')
}
