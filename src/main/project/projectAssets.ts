/**
 * projectAssets.ts — asset manifest build + resolve (main process only).
 *
 * Electron-free by design (only fs / crypto / path): the pure mapping logic is
 * covered by the zero-dependency integration test, and no Electron import can
 * leak into the test build.
 *
 * Rules (task.txt Step 2 — no fallback, no silent error):
 * - SAVE: every referenced media file MUST exist and be readable. A missing
 *   file is a hard error — dangling references are never written.
 * - LOAD: every manifest asset MUST resolve to an existing file, trying
 *   project-relative path first, then the saved original absolute path. Any
 *   unresolved asset aborts the whole load with a MissingMediaError that lists
 *   every missing file and where it was expected — never a half-loaded project.
 * - Hashing is streaming (constant memory) with a stat-keyed cache
 *   (path → size+mtime → hash) so repeated saves don't re-hash gigabytes.
 *   The cache key includes size AND mtime: any content change re-hashes.
 */

import { createReadStream, promises as fsPromises } from 'fs'
import { createHash } from 'crypto'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import {
  normalizeFsPath,
  type AssetRecord,
} from '../../shared/project/projectSchema'
import type { RelinkMissingEntry } from '../../shared/project/relink'

export interface MediaUsage {
  path: string
  sourceDurationMs: number
}

export interface MissingMediaEntry {
  id: string
  filename: string
  /** Every location that was probed, in order. */
  expected: string[]
}

export class MissingMediaError extends Error {
  readonly missing: MissingMediaEntry[]

  constructor(missing: MissingMediaEntry[]) {
    const lines = missing.map(
      (entry) => `  - ${entry.filename} (expected: ${entry.expected.join(' | ')})`
    )
    super(
      `Missing media files (${missing.length}):\n${lines.join('\n')}\n` +
        'Restore the files to one of the expected locations (or move them next ' +
        'to the .clipzu project) and open the project again. Nothing was loaded.'
    )
    this.name = 'MissingMediaError'
    this.missing = missing
  }
}

/** Deterministic asset id: stable across saves for the same file. */
export function assetIdForPath(absolutePath: string): string {
  return `a_${createHash('sha256').update(normalizeFsPath(absolutePath)).digest('hex').slice(0, 16)}`
}

interface HashCacheEntry {
  sizeBytes: number
  mtimeMs: number
  hash: string
}

const hashCache = new Map<string, HashCacheEntry>()

function hashFileStreamed(absolutePath: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(absolutePath)
    stream.on('data', (chunk) => hash.update(chunk as Buffer))
    stream.on('error', (err) => rejectHash(err))
    stream.on('end', () => {
      try {
        resolveHash(hash.digest('hex'))
      } catch (err) {
        rejectHash(err)
      }
    })
  })
}

/**
 * Build the manifest for every unique media path used by the project.
 * THROWS on the first missing/unreadable file — the caller must not write.
 */
export async function buildAssetManifest(
  usages: MediaUsage[],
  projectDir: string
): Promise<{ assets: AssetRecord[]; pathToAssetId: Map<string, string> }> {
  const seen = new Map<string, MediaUsage>()
  for (const usage of usages) {
    const key = normalizeFsPath(resolve(usage.path))
    if (!seen.has(key)) seen.set(key, usage)
  }

  const assets: AssetRecord[] = []
  const pathToAssetId = new Map<string, string>()
  for (const [key, usage] of seen) {
    const absolutePath = resolve(usage.path)
    let stat: { size: number; mtimeMs: number }
    try {
      const fileStat = await fsPromises.stat(absolutePath)
      if (!fileStat.isFile()) {
        throw new Error(`not a regular file: ${absolutePath}`)
      }
      stat = { size: fileStat.size, mtimeMs: fileStat.mtimeMs }
    } catch (err) {
      throw new Error(
        `Cannot save: media file is missing or unreadable: ${absolutePath} (${(err as Error).message})`
      )
    }

    const cached = hashCache.get(key)
    let hash: string
    if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
      hash = cached.hash
    } else {
      try {
        hash = await hashFileStreamed(absolutePath)
      } catch (err) {
        throw new Error(
          `Cannot save: failed to hash media file: ${absolutePath} (${(err as Error).message})`
        )
      }
      hashCache.set(key, { sizeBytes: stat.size, mtimeMs: stat.mtimeMs, hash })
    }

    // Forward slashes always. Across drives path.relative returns an absolute
    // target — stored as-is and resolved directly on load (documented).
    const relativePath = relative(projectDir, absolutePath).replace(/\\/g, '/')
    const id = assetIdForPath(absolutePath)
    assets.push({
      id,
      filename: basename(absolutePath),
      relativePath,
      originalPath: absolutePath,
      hash,
      duration: usage.sourceDurationMs,
      metadata: { sizeBytes: stat.size, mtimeMs: stat.mtimeMs },
    })
    pathToAssetId.set(key, id)
  }

  assets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { assets, pathToAssetId }
}

function candidatePaths(asset: AssetRecord, projectDir: string): string[] {
  const candidates: string[] = []
  const fromRelative = isAbsolute(asset.relativePath)
    ? asset.relativePath
    : join(projectDir, asset.relativePath)
  candidates.push(resolve(fromRelative))
  const original = resolve(asset.originalPath)
  if (original !== candidates[0]) candidates.push(original)
  return candidates
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    const fileStat = await fsPromises.stat(absolutePath)
    return fileStat.isFile()
  } catch {
    return false
  }
}

/**
 * Resolve every manifest asset to a live absolute path.
 * THROWS MissingMediaError listing ALL unresolved assets — never partial.
 * A file found at originalPath instead of the project-relative location is
 * reported in notes (explicit remap, never silent).
 *
 * `overrides` (relink): asset.id → user-chosen absolute path. A valid
 * override WINS over built-in candidates; an override pointing at a missing
 * file does NOT mask the asset — it is reported as still-missing with the
 * override path included among the probed locations, so the user sees it.
 */
export async function resolveAssetManifest(
  assets: AssetRecord[],
  projectDir: string,
  overrides?: ReadonlyMap<string, string>
): Promise<{ resolved: Map<string, string>; notes: string[] }> {
  const resolved = new Map<string, string>()
  const notes: string[] = []
  const missing: MissingMediaEntry[] = []

  for (const asset of assets) {
    const candidates = candidatePaths(asset, projectDir)
    const override = overrides?.get(asset.id)
    if (override) {
      if (await fileExists(override)) {
        resolved.set(asset.id, resolve(override))
        notes.push(
          `asset[${asset.id}] "${asset.filename}": relinked to ${override}`
        )
        continue
      }
      candidates.unshift(resolve(override))
    }
    let hit: string | null = null
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        hit = candidate
        break
      }
    }
    if (hit === null) {
      missing.push({ id: asset.id, filename: asset.filename, expected: candidates })
      continue
    }
    resolved.set(asset.id, hit)
    if (hit !== candidates[0]) {
      notes.push(
        `asset[${asset.id}] "${asset.filename}": not beside project, using original location ${hit}`
      )
    }
  }

  if (missing.length > 0) {
    throw new MissingMediaError(missing)
  }
  return { resolved, notes }
}

// ---------------------------------------------------------------------------
// Relink helpers (Phase "remaining risks": one-click missing-media recovery)
// ---------------------------------------------------------------------------

/** Max directory depth for the recursive folder scan (bounds I/O on huge trees). */
const RELINK_SCAN_MAX_DEPTH = 6
/** Max files visited per scan (safety valve for enormous folders). */
const RELINK_SCAN_MAX_FILES = 20000

/**
 * Recursively scan `folder` for files whose basename matches any missing
 * entry (case-insensitive; tries the exact filename first). Returns a map
 * assetId → absolute candidate path. First match wins, never throws.
 */
export async function scanFolderForMissing(
  folder: string,
  missing: readonly RelinkMissingEntry[]
): Promise<Map<string, string>> {
  const wanted = new Map<string, string[]>()
  for (const entry of missing) {
    const names = new Set<string>([entry.filename.toLowerCase()])
    for (const expected of entry.expected) {
      names.add(basename(expected).toLowerCase())
    }
    wanted.set(entry.id, [...names])
  }

  const found = new Map<string, string>()
  let visited = 0

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > RELINK_SCAN_MAX_DEPTH || visited >= RELINK_SCAN_MAX_FILES) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of entries) {
      if (visited >= RELINK_SCAN_MAX_FILES) return
      const full = join(dir, dirent.name)
      if (dirent.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!dirent.isFile()) continue
      visited += 1
      const lower = dirent.name.toLowerCase()
      for (const [id, names] of wanted) {
        if (found.has(id)) continue
        if (names.includes(lower)) {
          found.set(id, full)
        }
      }
      if (found.size === wanted.size) return
    }
  }

  await walk(folder, 0)
  return found
}

/** Project directory for a project file path (manifest root). */
export function projectDirForFile(projectFilePath: string): string {
  return dirname(resolve(projectFilePath))
}
