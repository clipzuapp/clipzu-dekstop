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
 * Wrap text into lines using the same algorithm as Preview canvas wrapText().
 * Uses Canvas2D measureText for accuracy. Falls back to heuristic.
 */
export function wrapTextToLines(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
  maxWidth: number
): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const w = measureTextWidthPx(testLine, fontFamily, fontSize, fontWeight)
    if (w > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

/**
 * Measure wrapped text block dimensions in pixels.
 * Returns { width, height, lines } matching the canvas rendering.
 */
export function measureWrappedTextBlock(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
  maxWidth: number
): { width: number; height: number; lines: string[] } {
  const lines = wrapTextToLines(text, fontFamily, fontSize, fontWeight, maxWidth)
  if (lines.length === 0) return { width: 0, height: 0, lines: [] }
  let maxLineWidth = 0
  for (const line of lines) {
    const w = measureTextWidthPx(line, fontFamily, fontSize, fontWeight)
    if (w > maxLineWidth) maxLineWidth = w
  }
  return {
    width: maxLineWidth,
    height: lines.length * fontSize * 1.3,
    lines
  }
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
  // Use resolution-scaled font size so measureText matches canvas drawing
  const resScale = canvasWidth / 1080
  const renderFontSize = fontSize * resScale * scale
  const maxWidth = canvasWidth * 0.8
  const block = measureWrappedTextBlock(text, fontFamily, renderFontSize, fontWeight, maxWidth)
  const wPct = (block.width / canvasWidth) * 100
  const hPct = (block.height / canvasHeight) * 100
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
  // Use resolution-scaled font size so measureText matches canvas drawing
  const resScale = canvasWidth / 1080
  const renderFontSize = fontSize * resScale * scale
  const maxWidth = canvasWidth * 0.8
  const block = measureWrappedTextBlock(text, fontFamily, renderFontSize, fontWeight, maxWidth)
  return {
    x: (styleX / 100) * canvasWidth - block.width / 2,
    y: (styleY / 100) * canvasHeight - block.height / 2,
    width: block.width,
    height: block.height
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
