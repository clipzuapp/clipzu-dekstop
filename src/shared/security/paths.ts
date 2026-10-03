/**
 * paths.ts — file-access allowlist SSOT (Phase 6, P6.2 / audit S2).
 *
 * `file:readBuffer` used to read ANY absolute path with no validation, so a
 * renderer compromise meant arbitrary local file reads. Access is now gated:
 *
 * 1. The path must normalize cleanly (no NUL, no empty, `..` resolved —
 *    traversal attempts are rejected, never resolved-then-checked).
 * 2. The file must be AUDIO (the only bytes both `file:readBuffer` callers
 *    — AudioEngine preload and WaveformService decode — can consume).
 * 3. The file must be vouched: either an explicitly registered media path
 *    (probed imports, project manifest assets, relink resolutions, sfx
 *    library, notification sounds) or inside a voucher directory (app
 *    resources, userData caches, temp scratch).
 *
 * Pure module: hand-rolled normalization (no node:path — this ships to the
 * renderer bundle too) — safe for node:test.
 */

import { AUDIO_EXTENSIONS } from '../media/extensions'
import { normalizeNFC } from '../utils/encoding'

export const FILE_ACCESS_DENIED = 'FILE_ACCESS_DENIED'

export interface FileAccessContext {
  /** Explicitly vouched absolute file paths (normalized forms accepted). */
  allowedFiles: readonly string[]
  /** Voucher directories (recursive). */
  allowedDirs: readonly string[]
}

/**
 * Normalize a candidate path for access checks. Returns null when the path
 * is unusable: non-string, empty/blank, NUL byte, or `..` escaping past the
 * root/anchor. Forward slashes fold to backslashes; duplicate separators
 * collapse; `.` segments drop; drive letters and UNC anchors preserved.
 */
export function normalizeAccessPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null
  if (candidate.includes('\0')) return null
  const trimmed = candidate.trim()
  if (trimmed.length === 0) return null
  // NFC first so macOS NFD spellings match the voucher set (Phase 9 policy).
  const folded = normalizeNFC(trimmed).replace(/\//g, '\\')
  // Anchor: drive letter (`C:\…`), UNC (`\\server\share\…`), or none.
  let anchor = ''
  let rest = folded
  const unc = rest.match(/^\\\\([^\\]+)\\([^\\]+)(\\|$)/)
  const drive = rest.match(/^([a-zA-Z]:)(\\|$)/)
  if (unc) {
    anchor = `\\\\${unc[1]}\\${unc[2]}`
    rest = rest.slice(unc[0].length)
  } else if (drive) {
    anchor = drive[1].toLowerCase()
    rest = rest.slice(drive[0].length)
  } else if (rest.startsWith('\\')) {
    anchor = '\\'
  }
  const out: string[] = []
  for (const seg of rest.split('\\')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null // escapes past the anchor
      out.pop()
      continue
    }
    out.push(seg)
  }
  return anchor + '\\' + out.join('\\')
}

/** True when the normalized path sits inside (or equals) the normalized dir. */
export function isPathWithinDir(filePath: string, dir: string): boolean {
  const file = normalizeAccessPath(filePath)
  const base = normalizeAccessPath(dir)
  if (file === null || base === null) return false
  const f = file.toLowerCase()
  const b = base.toLowerCase().replace(/\\+$/, '') + '\\'
  return f === b.slice(0, -1) || f.startsWith(b)
}

/** True when the path names an audio file (the only servable kind). */
export function isServableAudioPath(filePath: string): boolean {
  const normalized = normalizeAccessPath(filePath)
  if (normalized === null) return false
  const dot = normalized.lastIndexOf('.')
  if (dot < 0) return false
  const ext = normalized.slice(dot + 1).toLowerCase()
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext)
}

export type FileAccessVerdict =
  | { ok: true; normalized: string }
  | { ok: false; code: typeof FILE_ACCESS_DENIED; reason: string }

/**
 * Gate a `file:readBuffer` request. Fail-closed with a typed reason —
 * callers surface it loudly (toast + log), never an empty buffer.
 */
export function checkFileReadAccess(
  candidate: unknown,
  ctx: FileAccessContext
): FileAccessVerdict {
  const normalized = normalizeAccessPath(candidate)
  if (normalized === null) {
    return { ok: false, code: FILE_ACCESS_DENIED, reason: 'unusable path (empty, NUL, or escapes its anchor)' }
  }
  if (!isServableAudioPath(normalized)) {
    return { ok: false, code: FILE_ACCESS_DENIED, reason: 'not a servable audio file' }
  }
  const lowered = normalized.toLowerCase()
  for (const f of ctx.allowedFiles) {
    const v = normalizeAccessPath(f)
    if (v !== null && v.toLowerCase() === lowered) {
      return { ok: true, normalized }
    }
  }
  for (const d of ctx.allowedDirs) {
    if (isPathWithinDir(normalized, d)) {
      return { ok: true, normalized }
    }
  }
  return { ok: false, code: FILE_ACCESS_DENIED, reason: 'path is outside the media allowlist' }
}
