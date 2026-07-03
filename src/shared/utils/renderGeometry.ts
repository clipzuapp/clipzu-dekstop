/**
 * renderGeometry.ts — Shared render geometry utilities (SSOT)
 *
 * Pure functions used by BOTH:
 *   - Renderer process: Canvas2D caption drawing (Preview/index.tsx)
 *   - Main process: ASS subtitle generation (srt.ts, FFmpegService.ts)
 *
 * No Electron, Node.js, or browser-specific imports. Safe to import from
 * either process. Follows the same pattern as shared/utils/srt.ts.
 *
 * Requirements: 2.8 (F1), 2.10 (F3), 2.12
 */

// ---------------------------------------------------------------------------
// F1 — Caption layout geometry
// ---------------------------------------------------------------------------

export interface CanvasDims {
  width: number
  height: number
}

export interface CaptionLayout {
  /** Absolute pixel X of caption anchor in output coordinate space */
  cx: number
  /** Absolute pixel Y of caption anchor in output coordinate space */
  cy: number
  /** Scaled font size in output pixels */
  fontSize: number
  /**
   * Resolution scale factor (outputWidth / 1080).
   * Used by Canvas2D draw functions for stroke widths, padding, etc.
   */
  resScale: number
}

/**
 * Compute caption anchor position and font size for a given output canvas.
 *
 * This is the SSOT formula for both Canvas2D rendering and ASS margin
 * generation. Any change to caption positioning MUST go through this
 * function — not be duplicated in srt.ts or Preview/index.tsx.
 *
 * Formula:
 *   fontSize = style.fontSize × (outputHeight / 1080) × scale
 *   cx       = (style.x / 100) × outputWidth
 *   cy       = (style.y / 100) × outputHeight
 *   resScale = outputWidth / 1080
 *
 * @param style   Caption style with x/y as percentages (0–100), fontSize in pts at 1080p
 * @param output  Target canvas/output dimensions in pixels
 */
export function computeCaptionLayout(
  style: { x: number; y: number; fontSize: number; scale?: number },
  output: CanvasDims
): CaptionLayout {
  const resScale = output.width / 1080
  // Font size scales with output HEIGHT (not width) — preserves vertical proportion
  const fontSize = style.fontSize * (output.height / 1080) * (style.scale ?? 1)
  const cx = (style.x / 100) * output.width
  const cy = (style.y / 100) * output.height
  return { cx, cy, fontSize, resScale }
}

// ---------------------------------------------------------------------------
// F3 — Word timing index resolution
// ---------------------------------------------------------------------------

export interface WordTimingSlim {
  startMs: number
  endMs: number
}

/**
 * Resolve the index of the active word at a given elapsed time using binary search.
 *
 * This is the SSOT for word-boundary computation, used by:
 *   - wordActivation.ts (Preview — wraps this in a stateful frame cache)
 *   - srt.ts expandExportClip (ASS export — uses this to validate entry boundaries)
 *
 * Activation rule: word is active when startMs <= elapsedMs < endMs
 *
 * @param words     Array of word timings sorted by startMs ascending
 * @param elapsedMs Time in milliseconds since the caption clip's startMs
 * @returns 0-based index of the active word, or -1 if in a gap between words
 */
export function resolveWordActiveIndex(
  words: ReadonlyArray<WordTimingSlim>,
  elapsedMs: number
): number {
  if (words.length === 0) return -1

  let lo = 0
  let hi = words.length - 1

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const w = words[mid]

    if (elapsedMs < w.startMs) {
      hi = mid - 1
    } else if (elapsedMs >= w.endMs) {
      lo = mid + 1
    } else {
      // startMs <= elapsedMs < endMs — active
      return mid
    }
  }

  // In a gap (no word active at this timestamp)
  return -1
}

/**
 * When no word is active, find indices of prev/next words around elapsedMs.
 * Used by wordActivation.ts gap path (req 2.10 / F3).
 */
export function resolveWordGapNeighbors(
  words: ReadonlyArray<WordTimingSlim>,
  elapsedMs: number
): { prevIndex: number; nextIndex: number } {
  let prevIndex = -1
  let nextIndex = -1
  for (let i = 0; i < words.length; i++) {
    if (words[i].endMs <= elapsedMs) {
      prevIndex = i
    } else if (words[i].startMs > elapsedMs) {
      nextIndex = i
      break
    }
  }
  return { prevIndex, nextIndex }
}
