/**
 * ffmpegText.ts — Pure ffmpeg text helpers (Phase 7/9, task.txt).
 *
 * Zero-dependency; importable from main, renderer, and tests. Moved out of
 * FFmpegService (which imports Electron and is therefore untestable under
 * plain node:test) with byte-identical behavior. FFmpegService keeps thin
 * delegating wrappers so existing call sites are untouched.
 */

/**
 * Escape a path for use inside an FFmpeg filter graph string.
 * Backslashes become forward slashes; colons are escaped as \:
 * Single quotes are escaped as \' for safe embedding in filter options.
 * UTF-8 content (CJK, emoji) passes through untouched — spawn() passes argv
 * directly with no shell, so no further escaping is needed or wanted.
 */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/** Include head and tail of stderr in error messages (bounded). */
export function formatStderrMessage(stderr: string): string {
  if (stderr.length <= 600) return stderr.trim()
  return `${stderr.slice(0, 300).trim()}...${stderr.slice(-300).trim()}`
}

/** Classify common FFmpeg failure patterns. */
export function classifyFfmpegError(stderr: string): string | null {
  const patterns = [
    /Stream specifier[^\n]*does not match[^\n]*/i,
    /Invalid option[^\n]*/i,
    /No such file or directory[^\n]*/i,
    /Error while opening encoder[^\n]*/i,
    /moov atom not found[^\n]*/i,
  ]
  for (const pattern of patterns) {
    const match = stderr.match(pattern)
    if (match) return match[0].trim()
  }
  return null
}

export function buildFfmpegError(code: number | null, stderr: string): Error {
  const classified = classifyFfmpegError(stderr)
  const body = formatStderrMessage(stderr)
  const prefix = classified ? `${classified}: ` : ''
  return new Error(`FFmpeg exited with code ${code}: ${prefix}${body}`)
}

/**
 * Append a chunk to a capped text buffer. Keeps the TAIL (where ffmpeg /
 * whisper print the fatal error and the latest progress line) and drops the
 * head once over budget. Replaces unbounded `stderr += chunk` accumulation
 * (O(n^2) string copying on hour-long jobs).
 */
export function appendCappedText(
  current: string,
  chunk: string,
  maxChars = 16 * 1024
): string {
  const next = current + chunk
  return next.length > maxChars ? next.slice(-maxChars) : next
}

/**
 * Append a timeline `enable` window to a filter fragment, on the ABSOLUTE
 * export timeline (seconds). All keyframed/baked filters use this so the
 * windows line up with the overlay `enable='gte(t,..)*lt(t,..)'` chain.
 */
export function withEnableWindow(
  filter: string,
  startMs: number,
  endMs: number
): string {
  const a = (Math.max(0, startMs) / 1000).toFixed(3)
  const b = (Math.max(0, endMs) / 1000).toFixed(3)
  return `${filter}:enable='between(t,${a},${b})'`
}
