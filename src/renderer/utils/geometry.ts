/**
 * Shared Geometry Engine — Single source of truth for all text measurement.
 * Used by Preview Canvas, TransformOverlay, Inspector, hit testing, drag, and resize.
 *
 * Design: All computations flow through these two functions.
 * No component should compute text dimensions independently.
 */

export interface TextClipBoundsPercent {
  /** Left edge as percentage of canvas width (0–100) */
  left: number
  /** Top edge as percentage of canvas height (0–100) */
  top: number
  /** Width as percentage of canvas width (0–100) */
  width: number
  /** Height as percentage of canvas height (0–100) */
  height: number
}

export interface TextClipBoundsPixel {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Estimate pixel width of text using character-count heuristic.
 * Matches the 0.55 × fontSize × charCount formula used across the editor.
 * For production: replace with Canvas2D measureText() call.
 */
export function estimateTextWidthPx(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55
}

// ---------------------------------------------------------------------------
// Shared offscreen canvas for accurate text measurement (SSOT)
// ---------------------------------------------------------------------------

let _measureCanvas: HTMLCanvasElement | null = null
let _measureCtx: CanvasRenderingContext2D | null = null

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (_measureCtx) return _measureCtx
  try {
    _measureCanvas = document.createElement('canvas')
    _measureCtx = _measureCanvas.getContext('2d')
    return _measureCtx
  } catch {
    return null
  }
}

/**
 * Measure actual rendered text width using Canvas2D measureText.
 * Returns pixel width. Falls back to heuristic if canvas is unavailable.
 */
export function measureTextWidthPx(text: string, fontFamily: string, fontSize: number, fontWeight: number): number {
  const ctx = getMeasureContext()
  if (!ctx) return estimateTextWidthPx(text, fontSize)
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  return ctx.measureText(text).width
}

/**
 * Get bounding box for a TextClip in percentage coordinates (for DOM overlay).
 * Returns { left, top, width, height } all as 0–100 percentages.
 */
export function getTextClipPercentBounds(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
  scale: number,
  styleX: number,
  styleY: number,
  canvasWidth: number,
  canvasHeight: number
): TextClipBoundsPercent {
  const estW = measureTextWidthPx(text, fontFamily, fontSize, fontWeight) * scale
  const estH = fontSize * 1.3 * scale
  const wPct = (estW / canvasWidth) * 100
  const hPct = (estH / canvasHeight) * 100
  return {
    left: styleX - wPct / 2,
    top: styleY - hPct / 2,
    width: wPct,
    height: hPct
  }
}

/**
 * Get bounding box for a TextClip in pixel coordinates (for Canvas rendering).
 * Returns { x, y, width, height } in logical pixels.
 */
export function getTextClipPixelBounds(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
  scale: number,
  styleX: number,
  styleY: number,
  canvasWidth: number,
  canvasHeight: number
): TextClipBoundsPixel {
  const estW = measureTextWidthPx(text, fontFamily, fontSize, fontWeight) * scale
  const estH = fontSize * 1.3 * scale
  return {
    x: (styleX / 100) * canvasWidth - estW / 2,
    y: (styleY / 100) * canvasHeight - estH / 2,
    width: estW,
    height: estH
  }
}

/**
 * Future: point-in-rotated-rectangle test.
 * When text rotation is implemented, replace simple axis-aligned checks with this.
 */
export function containsPointRotatedRect(
  px: number, py: number,
  cx: number, cy: number, w: number, h: number,
  rotationDeg: number
): boolean {
  if (rotationDeg === 0) {
    return px >= cx - w / 2 && px <= cx + w / 2 && py >= cy - h / 2 && py <= cy + h / 2
  }
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(-rad)
  const sin = Math.sin(-rad)
  const dx = px - cx
  const dy = py - cy
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  return lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2
}
