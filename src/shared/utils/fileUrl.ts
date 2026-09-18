/**
 * fileUrl.ts — Single canonical file:// encoder (Phase 9, task.txt).
 *
 * Replaces four divergent implementations (WaveformService raw, AudioEngine
 * per-segment, MediaPanel encodeURI, Preview per-segment). Exactly one
 * function builds file URLs everywhere; exactly one function parses them.
 *
 * Rules:
 * - Windows backslashes become forward slashes.
 * - Every path SEGMENT is encodeURIComponent-encoded, so spaces, '#', '?',
 *   '&', CJK, and emoji survive fetch()/decode round-trips. (encodeURI leaves
 *   '#?&' raw, which truncation-hides everything after '#' — the old MediaPanel
 *   bug.)
 * - Always emits the `file:///` form (works on Windows drive paths and POSIX).
 * - http(s) URLs pass through untouched (remote/stream sources).
 */

/** Encode an absolute filesystem path (or URL) to a fetchable file URL. */
export function toFileUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const normalized = pathOrUrl.replace(/\\/g, '/')
  const stripped = normalized.replace(/^file:\/\//, '')
  const segments = stripped.split('/').map((segment) => encodeURIComponent(segment))
  // Preserve a leading slash for POSIX absolute paths (first segment is '').
  return `file://${segments.join('/')}`
}

/**
 * Decode a file:// URL back to a filesystem path. Returns null for non-file
 * URLs. Percent-decoding is applied per segment (inverse of toFileUrl).
 */
export function fromFileUrl(url: string): string | null {
  if (!url.startsWith('file://')) return null
  const withoutScheme = url.replace(/^file:\/\//, '')
  return withoutScheme.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  }).join('/')
}

/** True when the value is a file:// URL (routes to direct read, not fetch). */
export function isFileUrl(value: string): boolean {
  return value.startsWith('file://')
}
