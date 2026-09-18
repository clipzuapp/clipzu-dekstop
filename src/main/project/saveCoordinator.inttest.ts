/**
 * saveCoordinator.inttest.ts — Phase 4 save-reliability regression tests.
 *
 * Task.txt cases: Ctrl+S spam, autosave-during-manual overlap, failed disk
 * write recovery, stale/corrupt temp handling. Crash-during-save atomicity is
 * verified by post-conditions (no .tmp residue, file always complete) — a
 * real SIGKILL mid-rename cannot be staged deterministically in-process.
 */

import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  atomicSave,
  resetSaveCoordinator,
  saveCoordinatorStats,
} from './saveCoordinator'

let root = ''

async function tmpLeftovers(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir)
  return entries.filter((e) => e.endsWith('.tmp'))
}

describe('atomic save coordinator (task.txt Phase 4)', () => {
  beforeEach(async () => {
    resetSaveCoordinator()
    root = await fs.mkdtemp(join(tmpdir(), 'clipzu-save-'))
  })

  after(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  })

  it('Ctrl+S spam: 20 parallel saves resolve, file holds latest bytes', async () => {
    const file = join(root, 'spam.clipzu')
    const payloads = Array.from({ length: 20 }, (_, i) => `{"generation":${i}}`)
    await Promise.all(payloads.map((data) => atomicSave(file, data)))
    const stats = saveCoordinatorStats(file)
    assert.equal(stats.generation, 20)
    assert.equal(await fs.readFile(file, 'utf-8'), '{"generation":19}')
    // Latest generation always committed last; intermediates may coalesce.
    assert.equal(stats.committed[stats.committed.length - 1], 20)
    assert.deepEqual(await tmpLeftovers(root), [])
  })

  it('autosave during manual save: latest wins, no interleave', async () => {
    const file = join(root, 'race.clipzu')
    const manual = `{"kind":"manual","body":"${'m'.repeat(200000)}"}`
    const autosave = '{"kind":"autosave"}'
    await Promise.all([atomicSave(file, manual), atomicSave(file, autosave)])
    // autosave admitted last → durable content is exactly autosave bytes.
    assert.equal(await fs.readFile(file, 'utf-8'), autosave)
    assert.deepEqual(await tmpLeftovers(root), [])
  })

  it('failed disk write rejects loudly, leaves previous file intact, chain survives', async () => {
    const good = join(root, 'good.clipzu')
    await atomicSave(good, '{"v":1}')
    // Make the destination uncreatable: parent path is an existing FILE.
    const blocker = join(root, 'blocker')
    await fs.writeFile(blocker, 'i am a file, not a directory')
    const bad = join(blocker, 'x.clipzu')
    await assert.rejects(
      atomicSave(bad, '{"v":2}'),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.ok((err as Error).message.length > 0)
        return true
      }
    )
    // Previous complete file byte-identical; no temp residue anywhere.
    assert.equal(await fs.readFile(good, 'utf-8'), '{"v":1}')
    assert.deepEqual(await tmpLeftovers(root), [])
    // Chain survives: a later save to the GOOD path still works.
    await atomicSave(good, '{"v":3}')
    assert.equal(await fs.readFile(good, 'utf-8'), '{"v":3}')
  })

  it('stale/corrupt temp file from a crash is removed, never resurrected', async () => {
    const file = join(root, 'crash.clipzu')
    await fs.writeFile(`${file}.tmp`, 'CORRUPT-LEFTOVER')
    await atomicSave(file, '{"v":1}')
    assert.equal(await fs.readFile(file, 'utf-8'), '{"v":1}')
    assert.deepEqual(await tmpLeftovers(root), [])
  })

  it('independent paths save in parallel without interference', async () => {
    const a = join(root, 'a.clipzu')
    const b = join(root, 'b.clipzu')
    await Promise.all([atomicSave(a, '{"p":"a"}'), atomicSave(b, '{"p":"b"}')])
    assert.equal(await fs.readFile(a, 'utf-8'), '{"p":"a"}')
    assert.equal(await fs.readFile(b, 'utf-8'), '{"p":"b"}')
    assert.equal(saveCoordinatorStats(a).generation, 1)
    assert.equal(saveCoordinatorStats(b).generation, 1)
  })
})
