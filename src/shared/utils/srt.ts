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
      /(\d{2}):(\d{2}):(\d{2})[, .](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[, .](\d{3})/
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

// ---------------------------------------------------------------------------
// Export SRT generation — ASS override tags, caption modes, animations
// ---------------------------------------------------------------------------

export interface ExportSRTOptions {
  captionMode?: 'full-phrase' | 'word-reveal' | 'karaoke' | 'single-word'
  animation?: 'none' | 'pop' | 'fade' | 'slide-up' | 'karaoke' | 'typewriter'
  revealFadeMs?: number
}

interface ExportClip {
  startMs: number
  endMs: number
  text: string
  words?: Array<{ word: string; startMs: number; endMs: number }>
}

interface SRTOutputEntry {
  startMs: number
  endMs: number
  text: string
}

/**
 * Build ASS override tag string for animation effects.
 * Returns tags wrapped in {} ready to prepend to subtitle text, or empty string for no animation.
 */
function buildAnimationTags(
  animation: ExportSRTOptions['animation'],
  entryStartMs: number,
  entryEndMs: number
): string {
  if (!animation || animation === 'none') return ''
  const duration = entryEndMs - entryStartMs
  const fadeIn = Math.min(200, Math.round(duration * 0.25))
  const fadeOut = Math.min(150, Math.round(duration * 0.15))

  switch (animation) {
    case 'fade':
      return `{\\fad(${fadeIn},${fadeOut})}`
    case 'pop':
      // Quick pop-in: short fade-in with slight overshoot feel
      return `{\\fad(${Math.min(100, Math.round(duration * 0.1))},${fadeOut})}`
    case 'slide-up':
      // Slide from 20px below to final position + fade-in
      return `{\\fad(${fadeIn},0)\\move(0,20,0,0,0,${fadeIn})}`
    case 'typewriter':
      // Fade each entry quickly to simulate character reveal
      return `{\\fad(${Math.min(50, Math.round(duration * 0.05))},0)}`
    case 'karaoke':
      return `{\\fad(${fadeIn},${fadeOut})}`
    default:
      return ''
  }
}

/**
 * Generate SRT content for export with ASS override tags, caption modes, and animations.
 * For full-phrase mode: standard SRT entries with optional animation tags.
 * For word-reveal/karaoke/single-word: word-level SRT entries with precise timing.
 */
export function generateExportSRT(
  clips: ExportClip[],
  options: ExportSRTOptions
): string {
  const mode = options.captionMode ?? 'full-phrase'
  const animation = options.animation ?? 'none'
  const entries: SRTOutputEntry[] = []

  for (const clip of clips) {
    const hasWords = clip.words && clip.words.length > 0

    if (mode === 'word-reveal' && hasWords) {
      // Words appear progressively — each word added to visible text at its timestamp.
      // For SRT, generate per-word entries with cumulative text.
      const words = clip.words!
      for (let i = 0; i < words.length; i++) {
        const wordStart = clip.startMs + words[i].startMs
        const wordEnd = i < words.length - 1
          ? clip.startMs + words[i + 1].startMs
          : clip.endMs
        const visibleText = words.slice(0, i + 1).map((w) => w.word).join(' ')
        const tags = buildAnimationTags(animation, wordStart, wordEnd)
        entries.push({ startMs: wordStart, endMs: wordEnd, text: tags + visibleText })
      }
      continue
    }

    if (mode === 'karaoke' && hasWords) {
      // Active word highlighted with color override, rest shown normally
      const words = clip.words!
      const fullText = clip.text
      for (let i = 0; i < words.length; i++) {
        const wordStart = clip.startMs + words[i].startMs
        const wordEnd = clip.startMs + words[i].endMs
        // Highlight active word with yellow, rest white
        const parts: string[] = []
        for (let j = 0; j < words.length; j++) {
          if (j === i) {
            parts.push(`{\\c&H00FFFF&}${words[j].word}{\\c&HFFFFFF&}`)
          } else {
            parts.push(words[j].word)
          }
        }
        const text = parts.length > 0 ? parts.join(' ') : fullText
        const tags = buildAnimationTags(animation, wordStart, wordEnd)
        entries.push({ startMs: wordStart, endMs: wordEnd, text: tags + text })
      }
      continue
    }

    if (mode === 'single-word' && hasWords) {
      // Show one word at a time
      const words = clip.words!
      for (const w of words) {
        const wordStart = clip.startMs + w.startMs
        const wordEnd = clip.startMs + w.endMs
        const tags = buildAnimationTags(animation, wordStart, wordEnd)
        entries.push({ startMs: wordStart, endMs: wordEnd, text: tags + w.word })
      }
      continue
    }

    // Default: full-phrase
    const tags = buildAnimationTags(animation, clip.startMs, clip.endMs)
    entries.push({ startMs: clip.startMs, endMs: clip.endMs, text: tags + clip.text })
  }

  return entries
    .map((entry, i) =>
      `${i + 1}\n${formatSRTTime(entry.startMs)} --> ${formatSRTTime(entry.endMs)}\n${entry.text}\n`
    )
    .join('\n')
}
