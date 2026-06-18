/**
 * Color Utilities — hex color conversion helpers
 * Used by both main process (FFmpeg ASS export) and renderer (Canvas rendering)
 * Pure functions — no Electron, Node, or browser dependencies
 */

/**
 * Convert hex #RRGGBB to ASS color format &HAABBGGRR
 * @param hex Hex color string (e.g. '#ff0000')
 * @param opacity 0-1 opacity value (default 0 = fully transparent)
 */
export function toAssColor(hex: string, opacity?: number): string {
  const alpha = opacity !== undefined
    ? Math.round(opacity * 255).toString(16).padStart(2, '0').toUpperCase()
    : '00'
  const r = hex.slice(1, 3)
  const g = hex.slice(3, 5)
  const b = hex.slice(5, 7)
  return `&H${alpha}${b}${g}${r}`
}

/**
 * Append hex alpha channel to a hex color
 * @param hex Hex color string (e.g. '#000000')
 * @param opacity 0-1 opacity value
 * @returns Hex string with alpha appended (e.g. '#00000080')
 */
export function toCssHexAlpha(hex: string, opacity: number): string {
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0')
  return `${hex}${alpha}`
}
