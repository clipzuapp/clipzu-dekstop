/**
 * Word Activation Engine — resolves word state at a given playhead position.
 *
 * Given a TextClip with word-level timestamps:
 *   - Determines which word is "active" (currently being spoken)
 *   - Resolves previous / next word for reveal/roll animations
 *   - Uses binary search for O(log n) lookup, with sequential caching for O(1) fast path
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE: Timing Layer vs Visual Layer
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This module is the TIMING LAYER — it produces pure temporal data:
 *   { activeWord, prevWord, nextWord, activeIndex, isSynthetic }
 *
 * It does NOT concern itself with:
 *   - Font, color, scale, glow, outline, highlight colors
 *   - Animation presets (pop, fade, slide-up, typewriter)
 *   - Caption mode rendering (full-phrase, word-reveal, karaoke, single-word)
 *   - Canvas2D drawing or DOM positioning
 *
 * The VISUAL LAYER (Preview/index.tsx, StylePanel) consumes this timing data
 * and applies visual styling independently. Future styling engines (Shorts presets,
 * theme packs) should layer on top of this timing engine without coupling.
 *
 * Activation rule (millisecond precision):
 *   word.startMs <= playheadMs < word.endMs
 *
 * Between words (gap):
 *   activeWord = null, prevWord = last word before gap, nextWord = first after gap
 */

import { resolveWordActiveIndex, resolveWordGapNeighbors } from '../../shared/utils/renderGeometry'

export interface WordTiming {
  word: string
  startMs: number
  endMs: number
}

export interface WordActivation {
  /** The word being spoken at playheadMs, or null if in a gap */
  activeWord: WordTiming | null
  /** The word immediately before the active word */
  prevWord: WordTiming | null
  /** The word immediately after the active word */
  nextWord: WordTiming | null
  /** 0-based index of the active word, or -1 if none */
  activeIndex: number
  /** Whether the word timestamps are synthetic (estimated, not from Whisper) */
  isSynthetic: boolean
}

/**
 * Cache for sequential playback optimization.
 * Avoids O(log n) binary search when playhead advances predictably.
 * Create one per TextClip via createActivationCache().
 */
export interface ActivationCache {
  lastPlayheadMs: number
  lastActivation: WordActivation | null
  /** Total words in the clip when cached (invalidated if count changes) */
  wordCount: number
}

/** Create a fresh activation cache for a TextClip */
export function createActivationCache(): ActivationCache {
  return { lastPlayheadMs: -1, lastActivation: null, wordCount: 0 }
}

/**
 * Reset a cache (call when TextClip words change, e.g. edit/merge/split).
 * Returns the same cache object, cleared.
 */
export function resetActivationCache(cache: ActivationCache): ActivationCache {
  cache.lastPlayheadMs = -1
  cache.lastActivation = null
  cache.wordCount = 0
  return cache
}

/**
 * Resolve word activation state for a TextClip at the given playhead time.
 *
 * Cached variant — uses an ActivationCache to avoid binary search during
 * sequential playback. Falls back to full binary search on:
 *   - First call (no cache)
 *   - Word count mismatch (clip was edited)
 *   - Playhead jump > 500ms (scrubbing, not sequential playback)
 *   - Active word changed (linear walk forward from last position)
 *
 * @param words - Array of word timings (must be sorted by startMs ascending)
 * @param playheadMs - Current playhead position in milliseconds
 * @param isSynthetic - Whether these timestamps are synthetic estimates
 * @param cache - Optional activation cache for sequential playback optimization
 * @returns WordActivation with prev/active/next word info
 */
export function resolveActiveWord(
  words: WordTiming[] | undefined,
  playheadMs: number,
  isSynthetic: boolean = false,
  cache?: ActivationCache
): WordActivation {
  if (!words || words.length === 0) {
    if (cache) cache.wordCount = 0
    return { activeWord: null, prevWord: null, nextWord: null, activeIndex: -1, isSynthetic }
  }

  // ---- Cached fast path for sequential playback ----
  if (cache && cache.lastActivation && cache.wordCount === words.length) {
    const delta = playheadMs - cache.lastPlayheadMs

    // Small positive delta (< 500ms): likely sequential playback, try fast path
    if (delta >= 0 && delta < 500) {
      const lastIdx = cache.lastActivation.activeIndex
      const lastActive = cache.lastActivation.activeWord

      // Case 1: Still within the same active word
      if (lastIdx >= 0 && lastActive && playheadMs >= lastActive.startMs && playheadMs < lastActive.endMs) {
        cache.lastPlayheadMs = playheadMs
        return cache.lastActivation
      }

      // Case 2: Moved to the next word (most common during playback)
      if (lastIdx + 1 < words.length) {
        const nextWord = words[lastIdx + 1]
        if (playheadMs >= nextWord.startMs && playheadMs < nextWord.endMs) {
          const activation: WordActivation = {
            activeWord: nextWord,
            prevWord: lastIdx >= 0 ? words[lastIdx] : null,
            nextWord: lastIdx + 2 < words.length ? words[lastIdx + 2] : null,
            activeIndex: lastIdx + 1,
            isSynthetic
          }
          cache.lastPlayheadMs = playheadMs
          cache.lastActivation = activation
          return activation
        }
      }

      // Case 3: In a gap between last active word and next word
      if (lastIdx >= 0 && lastActive && playheadMs >= lastActive.endMs) {
        const nextIdx = lastIdx + 1 < words.length ? lastIdx + 1 : -1
        if (nextIdx >= 0 && playheadMs < words[nextIdx].startMs) {
          const activation: WordActivation = {
            activeWord: null,
            prevWord: lastActive,
            nextWord: words[nextIdx],
            activeIndex: -1,
            isSynthetic
          }
          cache.lastPlayheadMs = playheadMs
          cache.lastActivation = activation
          return activation
        }
      }
    }
  }

  // ---- Full binary search — delegated to shared SSOT (req 2.10 / F3) ----
  // resolveWordActiveIndex is the single authoritative implementation; both
  // the preview cache fast-path and the ASS exporter use the same algorithm.
  const activeIndex = resolveWordActiveIndex(words, playheadMs)

  let activation: WordActivation

  if (activeIndex === -1) {
    const { prevIndex, nextIndex } = resolveWordGapNeighbors(words, playheadMs)
    activation = {
      activeWord: null,
      prevWord: prevIndex >= 0 ? words[prevIndex] : null,
      nextWord: nextIndex >= 0 ? words[nextIndex] : null,
      activeIndex: -1,
      isSynthetic
    }
  } else {
    activation = {
      activeWord: words[activeIndex],
      prevWord: activeIndex > 0 ? words[activeIndex - 1] : null,
      nextWord: activeIndex < words.length - 1 ? words[activeIndex + 1] : null,
      activeIndex,
      isSynthetic
    }
  }

  // Update cache
  if (cache) {
    cache.lastPlayheadMs = playheadMs
    cache.lastActivation = activation
    cache.wordCount = words.length
  }

  return activation
}

/**
 * Get the cumulative text up to and including the given word index.
 * Used by word-reveal and typewriter modes.
 */
export function buildRevealText(words: WordTiming[], upToIndex: number): string {
  return words.slice(0, upToIndex + 1).map((w) => w.word).join(' ')
}

export default resolveActiveWord
