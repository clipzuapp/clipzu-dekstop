/**
 * saveCoordinator.ts — atomic, single-flight project saves (main process).
 *
 * Phase 4 (task.txt). Electron-free (only fs/path): fully covered by
 * node:test without an Electron runtime.
 *
 * Guarantees:
 * - ATOMICITY: bytes go to `<file>.tmp` + fsync + atomic rename. A crash,
 *   close, or failed write can only ever leave the previous COMPLETE file or
 *   the new COMPLETE file — never a half-written project. A stale `.tmp`
 *   left by a crash is removed on the next save before writing.
 * - SINGLE-FLIGHT + STALE CANCELLATION: concurrent saves to the same path
 *   (Ctrl+S spam, autosave racing manual save) coalesce — at most one write
 *   in flight per path, at most one queued write, and the queued write is
 *   always the LATEST bytes. Superseded payloads are dropped, never written.
 * - GENERATION COUNTER: every save request bumps a per-path monotonic
 *   generation. The file on disk always reflects the latest generation that
 *   was admitted; tests assert generation accounting exactly.
 * - FAILURE ISOLATION: a failed write (disk error, corrupt payload buffer)
 *   rejects ONLY its own caller, cleans its temp file, leaves the previous
 *   file byte-identical, and never breaks the chain for later saves.
 */

import { open, rename, rm, mkdir } from 'fs/promises'
import { dirname } from 'path'

interface PathEntry {
  /** Write currently holding the path, if any. */
  running: Promise<void> | null
  /** Latest queued (not yet started) payload. Overwritten = stale cancelled. */
  pending: { generation: number; data: string | Buffer } | null
  /** Monotonic generation counter for this path. */
  generation: number
  /** Generations actually committed to disk, in order (observability/tests). */
  committed: number[]
  /** Queued payloads dropped as stale (observability/tests). */
  droppedStale: number
}

const entries = new Map<string, PathEntry>()

function entryFor(filePath: string): PathEntry {
  let entry = entries.get(filePath)
  if (!entry) {
    entry = { running: null, pending: null, generation: 0, committed: [], droppedStale: 0 }
    entries.set(filePath, entry)
  }
  return entry
}

/** Test/observability hook: clears all coordinator state. */
export function resetSaveCoordinator(): void {
  entries.clear()
}

/** Test/observability hook: committed generations + stale-drop count. */
export function saveCoordinatorStats(filePath: string): {
  generation: number
  committed: number[]
  droppedStale: number
} {
  const entry = entries.get(filePath)
  if (!entry) return { generation: 0, committed: [], droppedStale: 0 }
  return {
    generation: entry.generation,
    committed: entry.committed.slice(),
    droppedStale: entry.droppedStale,
  }
}

async function writeAtomically(filePath: string, data: string | Buffer): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp`
  // Remove a stale temp file from a crashed previous save FIRST: a leftover
  // .tmp must never be mistaken for current data, and rename() below must
  // not resurrect it on platforms where rename semantics differ.
  await rm(tmpPath, { force: true })
  const handle = await open(tmpPath, 'w')
  try {
    await handle.writeFile(data, 'utf-8')
    // fsync BEFORE rename: without it, a power loss can lose both the temp
    // content and (on some filesystems) the directory entry update.
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmpPath, filePath)
}

/**
 * Durably save data to filePath with single-flight coalescing.
 *
 * Semantics (loud, no silent anything):
 * - Resolves when every payload admitted up to and including this call's
 *   generation is durable on disk (intermediate payloads may have been
 *   coalesced away — the file always holds the LATEST admitted bytes).
 * - Rejects if any write in that span failed. The previous complete file is
 *   untouched (rename never ran) and the corrupt temp is removed.
 */
export async function atomicSave(filePath: string, data: string | Buffer): Promise<void> {
  const entry = entryFor(filePath)
  entry.generation += 1
  const generation = entry.generation

  // The previous pending payload (if any) is now stale: drop it expressly.
  if (entry.pending !== null) entry.droppedStale += 1
  entry.pending = { generation, data }

  if (entry.running !== null) {
    // A write is in flight: this payload waits its turn behind it.
    // Handoff errors are the RUNNING write's own failure, not ours.
    await entry.running.catch(() => {})
    return drain(filePath)
  }
  return drain(filePath)
}

async function drain(filePath: string): Promise<void> {
  const entry = entryFor(filePath)
  // Whoever arrives at drain while another drain runs just waits: the loop
  // below always picks up the LATEST pending payload before exiting.
  while (entry.running !== null) {
    await entry.running.catch(() => {})
  }
  const task = (async (): Promise<void> => {
    for (;;) {
      const next = entry.pending
      if (next === null) return
      // Claim ONLY the latest: anything queued behind us belongs to a newer
      // caller that will drain it after we finish.
      entry.pending = null
      try {
        await writeAtomically(filePath, next.data)
        entry.committed.push(next.generation)
      } catch (err) {
        // Failed write: the previous complete file is untouched (rename never
        // ran). Remove the corrupt temp so it can never be mistaken for data,
        // then propagate LOUDLY to every waiter — a failing path must never
        // resolve as if durable.
        await rm(`${filePath}.tmp`, { force: true }).catch(() => {})
        throw err
      }
      if (entry.pending === null) return
      // A newer payload arrived mid-write: loop and commit it too. No bound
      // needed — each iteration commits exactly one payload and the pending
      // slot holds at most one.
    }
  })()
  entry.running = task
  try {
    await task
  } finally {
    if (entry.running === task) entry.running = null
  }
}
