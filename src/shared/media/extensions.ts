/**
 * extensions.ts — media extension SSOT (Phase 1, P1.4).
 *
 * Single source of truth for supported media extensions, consumed by:
 * - MediaPanel drag-and-drop + isAudio classification (renderer)
 * - ffmpeg:openMediaDialog native filter (main)
 * - project relink locate/scan filters (main)
 *
 * Previously three inline lists diverged (native dialog omitted m4a).
 * Any fix that adds a constant must delete the old inline copies (G1).
 *
 * Pure module: no DOM, no Electron, no Node imports — safe for node:test.
 */

/** Video container extensions (no leading dot, lowercase). */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm'] as const

/** Audio extensions (no leading dot, lowercase). Includes m4a. */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a'] as const

/**
 * Still-image extensions (P4.1, first-frame only). Animated gif/webp play
 * as a frozen first frame — full animation support is future work.
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] as const

/** Every importable media extension (video + audio + stills). */
export const MEDIA_EXTENSIONS: readonly string[] = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS]

/**
 * Default still duration in ms (P4.2: Clip.imageDurationMsDefault).
 * Stills probe at 0ms via ffprobe, so imports take this instead.
 */
export const STILL_IMAGE_DEFAULT_DURATION_MS = 3000

/** Basename extension extraction: lowercases, strips query/hash, no dot. */
export function getFileExtension(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  const clean = base.split(/[?#]/)[0] ?? base
  const dot = clean.lastIndexOf('.')
  if (dot < 0) return ''
  return clean.slice(dot + 1).toLowerCase()
}

/** True when the path names a supported importable media file. */
export function isSupportedMedia(path: string): boolean {
  const ext = getFileExtension(path)
  return (MEDIA_EXTENSIONS as readonly string[]).includes(ext)
}

/** True when the path names an audio file (voice/music/sfx lane). */
export function isAudioFile(path: string): boolean {
  const ext = getFileExtension(path)
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext)
}

/** True when the path names a video file. */
export function isVideoFile(path: string): boolean {
  const ext = getFileExtension(path)
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext)
}

/** True when the path names a still image (P4 still path, first frame). */
export function isImageFile(path: string): boolean {
  const ext = getFileExtension(path)
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * Import duration mapping (P4.2): stills take the documented default
 * (probed 0ms carries no timing); timed media keeps the probed duration
 * (rounded, clamped ≥ 0; unprobed → 0, preserving existing behavior).
 */
export function resolveImportDurationMs(
  isImage: boolean,
  probedDurationMs: number | null | undefined
): number {
  if (isImage) return STILL_IMAGE_DEFAULT_DURATION_MS
  if (typeof probedDurationMs !== 'number' || !Number.isFinite(probedDurationMs)) return 0
  return Math.max(0, Math.round(probedDurationMs))
}

/** RegExp equivalent of isSupportedMedia for File.name / drag-drop filtering. */
export const MEDIA_EXTS_REGEX = /\.(mp4|mov|avi|mkv|webm|mp3|wav|aac|ogg|flac|m4a|png|jpg|jpeg|webp|bmp|gif)$/i

/** RegExp equivalent of isAudioFile for library isAudio classification. */
export const AUDIO_EXTS_REGEX = /\.(mp3|wav|aac|ogg|flac|m4a)$/i

/** RegExp equivalent of isImageFile for still classification. */
export const IMAGE_EXTS_REGEX = /\.(png|jpg|jpeg|webp|bmp|gif)$/i

/** Human-readable accepted list for toast/error copy (single-sourced). */
export const ACCEPTED_MEDIA_LABEL = [...MEDIA_EXTENSIONS].join(', ')

/**
 * Electron dialog filter entries for media open dialogs.
 * Returns a fresh array per call (dialog mutates nothing, but callers vary).
 */
export function mediaDialogFilters(): Array<{ name: string; extensions: string[] }> {
  return [
    // P4.1: covers video + audio + stills (renamed — 'Video/Audio' lied).
    { name: 'Media', extensions: [...MEDIA_EXTENSIONS] },
    { name: 'All Files', extensions: ['*'] },
  ]
}
