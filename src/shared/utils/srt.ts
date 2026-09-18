/**
 * SRT Utility — Single Source of Truth for SRT parse/generate/format
 * Used by both main process (project.handler.ts) and renderer (useCaption.ts)
 * Pure functions — no Electron, Node, or browser dependencies
 */

import { computeCaptionLayout } from './renderGeometry'
import type { CaptionStyle } from '../types/caption'
import { normalizeImportedText } from './encoding'

/**
 * ExportCaptionStyle is CaptionStyle. The alias is kept so existing call sites
 * (`type ExportCaptionStyle`, `ExportASSOptions.fallbackStyle`) compile without
 * changes to project.handler.ts and ExportDialog.
 */
export type ExportCaptionStyle = CaptionStyle

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
  // UTF-8 policy (Phase 9): strip BOM + normalize CRLF/CR before parsing so
  // foreign files never mangle timing or smuggle '\r' into caption text.
  const blocks = normalizeImportedText(content).trim().split(/\n\s*\n/)
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

export interface ExportASSOptions {
  outputWidth: number
  outputHeight: number
  projectWidth: number
  projectHeight: number
  fallbackStyle: ExportCaptionStyle
}

interface ExportClip {
  startMs: number
  endMs: number
  text: string
  words?: Array<{ word: string; startMs: number; endMs: number }>
  style?: ExportCaptionStyle
  /** Edge fades in ms (0 = none). Rendered as ASS \fad, matching Preview. */
  fadeInMs?: number
  fadeOutMs?: number
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
      // Active element highlighted — use same default gold as renderer and ASS exporter
      const words = clip.words!
      const fullText = clip.text
      for (let i = 0; i < words.length; i++) {
        const wordStart = clip.startMs + words[i].startMs
        const wordEnd = clip.startMs + words[i].endMs
        const parts: string[] = []
        for (let j = 0; j < words.length; j++) {
          if (j === i) {
            // &H0000D7FF& = #FFD700 in ASS BGR order, fully opaque
            parts.push(`{\\c&H0000D7FF&}${words[j].word}{\\c&H00FFFFFF&}`)
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

function formatASSTime(ms: number): string {
  const totalCs = Math.max(0, Math.round(ms / 10))
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const sec = totalSec % 60
  const min = Math.floor(totalSec / 60) % 60
  const hour = Math.floor(totalSec / 3600)
  return `${hour}:${pad(min)}:${pad(sec)}.${pad(cs)}`
}

function escapeASS(value: string): string {
  return value
    .replace(/\r?\n/g, '\\N')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
}

function toAssColorLocal(hex: string, opacity = 1): string {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffffff'
  const alpha = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  const r = normalized.slice(1, 3)
  const g = normalized.slice(3, 5)
  const b = normalized.slice(5, 7)
  return `&H${alpha}${b}${g}${r}`
}

function computeCaptionMargins(
  style: ExportCaptionStyle,
  outputWidth: number,
  outputHeight: number,
  projectWidth: number,
  projectHeight: number,
  fontSize: number
): { alignment: number; marginL: number; marginR: number; marginV: number } {
  const srcAspect = projectWidth / projectHeight
  const outAspect = outputWidth / outputHeight
  let videoW: number, videoH: number, padX: number, padY: number
  if (srcAspect > outAspect) {
    videoW = outputWidth
    videoH = Math.round(outputWidth / srcAspect)
    padX = 0
    padY = Math.round((outputHeight - videoH) / 2)
  } else {
    videoH = outputHeight
    videoW = Math.round(outputHeight * srcAspect)
    padY = 0
    padX = Math.round((outputWidth - videoW) / 2)
  }

  const assAlignment: Record<string, number> = {
    'bottom-left': 1, 'bottom-center': 2, 'bottom-right': 3,
    'center-left': 4, 'center-center': 5, 'center-right': 6,
    'top-left': 7, 'top-center': 8, 'top-right': 9
  }
  const alignKey = `${style.position ?? 'bottom'}-${style.alignment ?? 'center'}`
  const alignment = assAlignment[alignKey] ?? 2

  const y = style.y ?? 75
  const position = style.position ?? 'bottom'
  const estTextH = fontSize * 1.3
  let marginV: number
  if (position === 'top') {
    marginV = Math.round(padY + (y / 100) * videoH)
  } else if (position === 'center') {
    marginV = Math.round(padY + ((y - 50) / 100) * videoH)
  } else {
    marginV = Math.round(padY + ((100 - y) / 100) * videoH - estTextH / 2)
  }

  const x = style.x ?? 50
  const hAlign = style.alignment ?? 'center'
  let marginL = 10
  let marginR = 10
  if (hAlign === 'left') {
    marginL = Math.round(padX + (x / 100) * videoW)
  } else if (hAlign === 'right') {
    marginR = Math.round(padX + ((100 - x) / 100) * videoW)
  }

  return {
    alignment,
    marginL: Math.max(0, marginL),
    marginR: Math.max(0, marginR),
    marginV: Math.max(0, marginV)
  }
}

function expandExportClip(clip: ExportClip, style: ExportCaptionStyle): SRTOutputEntry[] {
  const mode = style.captionMode ?? 'full-phrase'
  const animation = style.animation ?? 'none'
  const hasWords = clip.words && clip.words.length > 0
  // Edge fades (Preview parity): \fad applies to the whole entry. Combined
  // with animation tags by taking the max fade-in (both are alpha ramps).
  const clipFadeTags =
    (clip.fadeInMs ?? 0) > 0 || (clip.fadeOutMs ?? 0) > 0
      ? `{\\fad(${Math.round(clip.fadeInMs ?? 0)},${Math.round(clip.fadeOutMs ?? 0)})}`
      : ''

  if (mode === 'word-reveal' && hasWords) {
    return clip.words!.map((word, i, words) => {
      const startMs = clip.startMs + word.startMs
      const endMs = i < words.length - 1 ? clip.startMs + words[i + 1].startMs : clip.endMs
      const text = words.slice(0, i + 1).map((w) => w.word).join(' ')
      return { startMs, endMs, text: buildAnimationTags(animation, startMs, endMs) + escapeASS(text) }
    })
  }

  if (mode === 'karaoke' && hasWords) {
    // activeHighlightColor drives the active element's text color in ASS (primary color override).
    // The canvas renderer uses it as a background fill + draws activeTextColor on top — a richer
    // visual not representable in plain ASS \c tags. Using it as text color is the best mapping.
    const activeHighlight = toAssColorLocal(style.activeHighlightColor ?? '#FFD700')
    const normalColor = toAssColorLocal(style.color ?? '#ffffff')
    return clip.words!.map((word, i, words) => {
      const startMs = clip.startMs + word.startMs
      const endMs = clip.startMs + word.endMs
      const text = words
        .map((w, j) => j === i
          ? `{\\c${activeHighlight}}${escapeASS(w.word)}{\\c${normalColor}}`
          : escapeASS(w.word))
        .join(' ')
      return { startMs, endMs, text: buildAnimationTags(animation, startMs, endMs) + text }
    })
  }

  if (mode === 'single-word' && hasWords) {
    return clip.words!.map((word) => {
      const startMs = clip.startMs + word.startMs
      const endMs = clip.startMs + word.endMs
      return { startMs, endMs, text: buildAnimationTags(animation, startMs, endMs) + escapeASS(word.word) }
    })
  }

  const tags = style.animation === 'typewriter' ? '' : buildAnimationTags(animation, clip.startMs, clip.endMs)
  return [{ startMs: clip.startMs, endMs: clip.endMs, text: clipFadeTags + tags + escapeASS(clip.text) }]
}

export function generateExportASS(clips: ExportClip[], options: ExportASSOptions): string {
  const styleNames = new Map<string, string>()
  const styles: string[] = []
  const dialogues: string[] = []

  const getStyleName = (style: ExportCaptionStyle): string => {
    // req 2.8 / F1 — fontSize via shared SSOT, not a local reimplementation
    const layout = computeCaptionLayout(
      { x: style.x ?? 50, y: style.y ?? 75, fontSize: style.fontSize, scale: style.scale },
      { width: options.outputWidth, height: options.outputHeight }
    )
    const fontSize = Math.round(layout.fontSize)
    const outlineWidth = Math.max(0, Math.round((style.strokeWidth ?? 0) * layout.resScale * (style.scale ?? 1)))
    const margins = computeCaptionMargins(
      style,
      options.outputWidth,
      options.outputHeight,
      options.projectWidth,
      options.projectHeight,
      fontSize
    )
    const key = JSON.stringify({
      fontFamily: style.fontFamily,
      fontSize,
      fontWeight: style.fontWeight,
      color: style.color ?? '#ffffff',
      bgColor: style.bgColor,
      bgOpacity: style.bgOpacity,
      strokeColor: style.strokeColor,
      outlineWidth,
      ...margins
    })
    const existing = styleNames.get(key)
    if (existing) return existing

    const name = `Clipzu${styleNames.size + 1}`
    styleNames.set(key, name)
    styles.push('Style: ' + [
      name,
      style.fontFamily,
      fontSize,
      toAssColorLocal(style.color ?? '#ffffff'),
      '&H00000000',
      toAssColorLocal(style.strokeColor ?? '#000000'),
      toAssColorLocal(style.bgColor ?? '#000000', style.bgOpacity ?? 0),
      (style.fontWeight ?? 500) >= 700 ? -1 : 0,
      0,
      0,
      0,
      100,
      100,
      0,
      0,
      1,
      outlineWidth,
      0,
      margins.alignment,
      margins.marginL,
      margins.marginR,
      margins.marginV,
      1
    ].join(','))
    return name
  }

  for (const clip of clips) {
    const style = clip.style ?? options.fallbackStyle
    const styleName = getStyleName(style)
    for (const entry of expandExportClip(clip, style)) {
      if (entry.endMs <= entry.startMs) continue
      dialogues.push(`Dialogue: 0,${formatASSTime(entry.startMs)},${formatASSTime(entry.endMs)},${styleName},,0,0,0,,${entry.text}`)
    }
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${options.outputWidth}`,
    `PlayResY: ${options.outputHeight}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...dialogues,
    ''
  ].join('\n')
}
