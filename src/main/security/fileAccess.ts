import { app } from 'electron'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  checkFileReadAccess,
  FILE_ACCESS_DENIED,
  type FileAccessContext,
} from '../../shared/security/paths'

/**
 * fileAccess — main-process file-read allowlist (Phase 6, P6.2 / audit S2).
 *
 * `file:readBuffer` used to serve ANY absolute path to the renderer. Reads
 * are now gated by the shared predicate over:
 *
 * - vouched FILES: paths the main process itself validated — probed media
 *   imports (getMediaInfo), resolved project-manifest assets (load + relink
 *   resolutions), the sfx library, and notification sounds. Session-scoped,
 *   FIFO-capped (unbounded growth would pin dead project media forever).
 * - voucher DIRS: app resources (assets, bin, models), userData (waveform
 *   cache, proxies, thumbnails, logs), and the temp scratch dir — recursive.
 *
 * Anything else fails closed with a typed FILE_ACCESS_DENIED error the
 * renderer surfaces loudly (toast + log), never an empty buffer.
 */

const MAX_VOUCHED_FILES = 5000

const vouchedFiles: string[] = []
const vouchedSet = new Set<string>()

function keyOf(normalized: string): string {
  return normalized.toLowerCase()
}

/** Register a main-validated media path as servable (idempotent, capped). */
export function vouchMediaFile(filePath: string): void {
  const key = keyOf(filePath)
  if (vouchedSet.has(key)) return
  vouchedFiles.push(filePath)
  vouchedSet.add(key)
  while (vouchedFiles.length > MAX_VOUCHED_FILES) {
    const dropped = vouchedFiles.shift()
    if (dropped !== undefined) vouchedSet.delete(keyOf(dropped))
  }
}

/** Register many validated paths at once (project load, sfx library). */
export function vouchMediaFiles(filePaths: Iterable<string>): void {
  for (const p of filePaths) vouchMediaFile(p)
}

function appResourceDirs(): string[] {
  const packaged = app.isPackaged
  const appPath = app.getAppPath()
  const resourcesPath = packaged ? process.resourcesPath : join(appPath, 'resources')
  const dirs = [
    join(packaged ? process.resourcesPath : appPath, 'assets'),
    join(resourcesPath, 'bin'),
    join(resourcesPath, 'models'),
    app.getPath('userData'),
    join(tmpdir(), 'clipzu'),
  ]
  return dirs
}

function accessContext(): FileAccessContext {
  return { allowedFiles: vouchedFiles, allowedDirs: appResourceDirs() }
}

export class FileAccessDeniedError extends Error {
  readonly code = FILE_ACCESS_DENIED
  constructor(reason: string) {
    super(`${FILE_ACCESS_DENIED}: ${reason}`)
  }
}

/** Gate one `file:readBuffer` request. Throws FileAccessDeniedError when closed. */
export function assertFileReadAllowed(candidate: unknown): string {
  const verdict = checkFileReadAccess(candidate, accessContext())
  if (!verdict.ok) {
    throw new FileAccessDeniedError(verdict.reason)
  }
  return verdict.normalized
}

/** Test seam: current voucher count (never paths — no exfiltration surface). */
export function vouchedFileCount(): number {
  return vouchedFiles.length
}
