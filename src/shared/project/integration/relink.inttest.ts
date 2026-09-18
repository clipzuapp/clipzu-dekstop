/**
 * relink.inttest.ts — missing-media relink protocol regression tests.
 *
 * Covers: error-message token round-trip, override-based manifest resolution,
 * bad-override reporting (never masking), recursive folder scan (incl.
 * unicode names + subfolders), and the all-or-nothing contract under
 * overrides.
 *
 * Zero dependencies: node:test + node:assert only.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatMissingMediaError,
  parseMissingMediaToken,
  type RelinkMissingEntry,
} from '../relink'
import {
  buildAssetManifest,
  resolveAssetManifest,
  scanFolderForMissing,
  MissingMediaError,
} from '../../../main/project/projectAssets'

let workDir = ''

async function writeFake(dir: string, name: string, bytes = `${name}-${Math.random()}`): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const file = join(dir, name)
  await fs.writeFile(file, Buffer.from(bytes))
  return file
}

describe('relink protocol', () => {
  before(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-relink-'))
  })
  after(async () => {
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('token round-trips through the error message', () => {
    const token = '1234abcd-ef56-7890-abcd-ef1234567890'
    const message = formatMissingMediaError(token, 'Missing media files (2):\n  - a.mp4')
    assert.equal(parseMissingMediaToken(message), token)
    assert.ok(message.includes('Missing media files'))
  })

  it('unrelated errors yield no token (dialog must not open)', () => {
    assert.equal(parseMissingMediaToken('Failed to load project: corrupt'), null)
    assert.equal(parseMissingMediaToken(''), null)
    assert.equal(parseMissingMediaToken('MISSING_MEDIA:'), null)
  })
})

describe('relink — override resolution', () => {
  before(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-relink-override-'))
  })
  after(async () => {
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('resolves a moved asset from an override', async () => {
    const mediaDir = join(workDir, 'media')
    const elsewhere = join(workDir, 'elsewhere')
    const original = await writeFake(mediaDir, 'shot.mp4')
    const projectDir = join(workDir, 'project')
    await fs.mkdir(projectDir, { recursive: true })
    const { assets } = await buildAssetManifest(
      [{ path: original, sourceDurationMs: 1000 }],
      projectDir
    )
    // Move the media: without an override the load fails.
    const moved = await writeFake(elsewhere, 'shot.mp4')
    await fs.rm(original, { force: true })
    await assert.rejects(resolveAssetManifest(assets, projectDir), MissingMediaError)

    const overrides = new Map([[assets[0].id, moved]])
    const { resolved, notes } = await resolveAssetManifest(assets, projectDir, overrides)
    assert.equal(resolved.get(assets[0].id), moved)
    assert.ok(notes.some((n) => n.includes('relinked')), JSON.stringify(notes))
  })

  it('a stale override never masks the missing asset (path is reported)', async () => {
    const mediaDir = join(workDir, 'media2')
    const original = await writeFake(mediaDir, 'clip.mp4')
    const projectDir = join(workDir, 'project2')
    await fs.mkdir(projectDir, { recursive: true })
    const { assets } = await buildAssetManifest(
      [{ path: original, sourceDurationMs: 1000 }],
      projectDir
    )
    await fs.rm(original, { force: true })
    const bogus = join(workDir, 'nope', 'clip.mp4')
    const overrides = new Map([[assets[0].id, bogus]])
    await assert.rejects(
      resolveAssetManifest(assets, projectDir, overrides),
      (err: unknown) => {
        assert.ok(err instanceof MissingMediaError)
        const entry = (err as MissingMediaError).missing[0]
        assert.ok(entry.expected.includes(bogus))
        return true
      }
    )
  })
})

describe('relink — recursive folder scan', () => {
  before(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-relink-scan-'))
  })
  after(async () => {
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('finds files in nested folders, matching by basename, incl. unicode', async () => {
    const root = join(workDir, 'library')
    const found = await writeFake(join(root, 'a', 'b'), 'shot-one.mp4')
    const foundUnicode = await writeFake(join(root, '导入', '素材'), '你好 世界 #1.mp4')
    // A decoy with a different name must not match.
    await writeFake(join(root, 'a'), 'shot-two.mp4')

    const missing: RelinkMissingEntry[] = [
      { id: 'asset_1', filename: 'shot-one.mp4', expected: ['/gone/shot-one.mp4'] },
      { id: 'asset_2', filename: '你好 世界 #1.mp4', expected: ['/gone/你好 世界 #1.mp4'] },
      { id: 'asset_3', filename: 'not-there.mp4', expected: ['/gone/not-there.mp4'] },
    ]
    const result = await scanFolderForMissing(root, missing)
    assert.equal(result.get('asset_1'), found)
    assert.equal(result.get('asset_2'), foundUnicode)
    assert.equal(result.has('asset_3'), false)
  })

  it('matches case-insensitively', async () => {
    const root = join(workDir, 'case')
    const file = await writeFake(root, 'MyVideo.MP4')
    const result = await scanFolderForMissing(root, [
      { id: 'x', filename: 'myvideo.mp4', expected: ['/gone/myvideo.mp4'] },
    ])
    assert.equal(result.get('x'), file)
  })

  it('returns empty for a nonexistent folder (never throws)', async () => {
    const result = await scanFolderForMissing(join(workDir, 'does-not-exist'), [
      { id: 'x', filename: 'a.mp4', expected: ['/gone/a.mp4'] },
    ])
    assert.equal(result.size, 0)
  })
})
