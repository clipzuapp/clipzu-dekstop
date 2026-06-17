/**
 * SRT Utility — Single Source of Truth for SRT parse/generate/format
 * Used by both main process (project.handler.ts) and renderer (useCaption.ts)
 * Pure functions — no Electron, Node, or browser dependencies
 */

export interface CaptionEntry {
  id: string
  startMs: number
  endMs: number
  text: string
  words?: Array<{ word: string; startMs: number; endMs: number }>
  /** Source of word-level timestamps: 'whisper' = from token-level JSON, 'synthetic' = estimated */
  wordTimestampsSource?: 'whisper' | 'synthetic'
  /** Per-entry position override (percentage 0-100 of canvas). Falls back to captionStyle.x/y. */
  position?: { x: number; y: number }
}

/**
 * Parse SRT content string into CaptionEntry array
 * Supports both comma and period millisecond separators (SRT and VTT)
 */
export function parseSRT(content: string): CaptionEntry[] {
  const entries: CaptionEntry[] = []
  const blocks = content.trim().split(/\n\s*\n/)
  let id = 0

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue

    const timeMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    )
    if (!timeMatch) continue

    const startMs =
      parseInt(timeMatch[1]) * 3600000 +
      parseInt(timeMatch[2]) * 60000 +
      parseInt(timeMatch[3]) * 1000 +
      parseInt(timeMatch[4])
    const endMs =
      parseInt(timeMatch[5]) * 3600000 +
      parseInt(timeMatch[6]) * 60000 +
      parseInt(timeMatch[7]) * 1000 +
      parseInt(timeMatch[8])
    const text = lines.slice(2).join('\n').trim()

    if (text) {
      entries.push({ id: `cap_${id++}`, startMs, endMs, text })
    }
  }

  return entries
}

/**
 * Generate SRT content string from caption entries
 */
export function generateSRT(
  entries: Array<{ startMs: number; endMs: number; text: string }>
): string {
  return entries
    .map((entry, i) => {
      return `${i + 1}\n${formatSRTTime(entry.startMs)} --> ${formatSRTTime(entry.endMs)}\n${entry.text}\n`
    })
    .join('\n')
}

/**
 * Format milliseconds to SRT timestamp: HH:MM:SS,mmm
 */
export function formatSRTTime(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`
}

function pad(num: number, width: number = 2): string {
  return num.toString().padStart(width, '0')
}
