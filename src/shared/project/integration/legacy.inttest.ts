/**
 * legacy.inttest.ts — Phase 10 legacy .ecp read + scale/unicode hardening.
 *
 * - Legacy CapCraft v1 payloads map to the loaded shape with every default
 *   REPORTED (preset fallback, session defaults) — never silent.
 * - Large projects (500 clips) round-trip through validate->manifest->
 *   migrate->serialize->validate->resolve->inject with identity.
 * - Unicode filenames (CJK, emoji, spaces, '#', parens) survive manifest
 *   build + resolution byte-identically.
 *
 * Zero dependencies: node:test + node:assert only.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  validateProjectFile,
  validateClipzuFile,
  migrateV1ToClipzuStrict,
  type NormalizedProjectFile,
  type CanonicalExportConfig,
  type ClipzuDocument,
} from '../projectSchema'
import {
  v1ToLoadedProject,
  defaultExportConfigForPreset,
} from '../legacyEcp'
import {
  buildAssetManifest,
  resolveAssetManifest,
} from '../../../main/project/projectAssets'
import { recalcTimelineDuration } from '../../utils/timeline'

const FULL_TRANSFORM = {
  x: 0, y: 0, scaleX: 1, scaleY: 1,
  rotation: 0, opacity: 1,
  cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
}

const FULL_STYLE = {
  fontFamily: 'Inter', fontSize: 48, fontWeight: 700,
  color: '#ffffff', strokeColor: '#000000', strokeWidth: 1,
  bgColor: '#000000', bgOpacity: 0.5,
  alignment: 'center', position: 'bottom',
  x: 50, y: 75, rotation: 0, scale: 1,
  animation: 'pop', captionMode: 'full-phrase', revealFadeMs: 0,
}

const EXPORT_CONFIG: CanonicalExportConfig = {
  preset: 'youtube',
  customWidth: 1920, customHeight: 1080,
  upscaleEnabled: false, upscaleAlgorithm: 'lanczos',
  codec: 'h264', qualityPreset: 'slow',
  bitrateKbps: null, bitrateMode: 'auto',
  exportFrameRange: null,
  audioOnly: false, fps: 30, hardwareAccel: false,
}

let workDir = ''
let mediaDir = ''

async function writeFakeMedia(dir: string, name: string): Promise<string> {
  const file = join(dir, name)
  await fs.writeFile(file, Buffer.from(`fake-bytes-${name}-${Date.now()}-${Math.random()}`))
  return file
}

function v1Payload(clips: Array<Record<string, unknown>>, extra?: Record<string, unknown>): Record<string, unknown> {
  const texts = [
    {
      id: 'text_1', startMs: 0, durationMs: 1000, endMs: 1000, trackIndex: 0,
      text: 'hi', fadeInMs: 0, fadeOutMs: 0,
    },
  ]
  return {
    version: '1.0',
    name: 'Legacy Project',
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    aspectRatio: '16:9',
    backgroundColor: '#000000',
    clips,
    audioTracks: [],
    textClips: texts,
    tracks: [
      { id: 'track_v0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false, solo: false },
    ],
    markers: [],
    captions: { entries: texts, style: FULL_STYLE, language: 'en' },
    exportPreset: 'youtube',
    playheadMs: 1234,
    zoom: 1,
    masterVolume: 0.9,
    loopEnabled: false,
    ...extra,
  }
}

function clipFor(path: string, id: string, startMs: number): Record<string, unknown> {
  return {
    id,
    path,
    startMs,
    sourceDurationMs: 5000,
    durationMs: 1000,
    trackIndex: 0,
    trimStart: 0,
    trimEnd: 4000,
    transform: { ...FULL_TRANSFORM },
    speed: 1,
    volume: 1,
    muted: false,
  }
}

describe('legacy .ecp read compatibility (Phase 10)', () => {
  before(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-legacy-'))
    mediaDir = join(workDir, 'media')
    await fs.mkdir(mediaDir, { recursive: true })
  })

  after(async () => {
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('maps a validated v1 project to the loaded shape with identity', async () => {
    const p = await writeFakeMedia(mediaDir, 'old-shot.mp4')
    const v1 = validateProjectFile(v1Payload([clipFor(p, 'clip_1', 0)]))
    assert.equal(v1.ok, true, JSON.stringify(v1.errors))
    const notes: string[] = []
    const loaded = v1ToLoadedProject(v1.data as NormalizedProjectFile, notes)
    assert.equal(loaded.version, '2.0')
    assert.equal(loaded.clips.length, 1)
    assert.equal(loaded.clips[0].path, p)
    assert.equal(loaded.playheadMs, 1234)
    assert.equal(loaded.exportConfig.preset, 'youtube')
    assert.deepEqual(loaded.captions.entries, loaded.textClips)
    // Full session present -> no default notes.
    assert.ok(!notes.some((n) => n.includes('defaulted')), JSON.stringify(notes))
  })

  it('unknown preset falls back to custom LOUDLY; missing session defaults LOUDLY', async () => {
    const p = await writeFakeMedia(mediaDir, 'old-shot2.mp4')
    const payload = v1Payload([clipFor(p, 'clip_1', 0)], {
      exportPreset: 'capcraft-8k-mega',
    }) as Record<string, unknown>
    delete payload['playheadMs']
    delete payload['zoom']
    delete payload['masterVolume']
    delete payload['loopEnabled']
    const v1 = validateProjectFile(payload)
    assert.equal(v1.ok, true, JSON.stringify(v1.errors))
    const notes: string[] = []
    const loaded = v1ToLoadedProject(v1.data as NormalizedProjectFile, notes)
    assert.equal(loaded.exportConfig.preset, 'custom')
    assert.equal(loaded.playheadMs, 0)
    assert.equal(loaded.zoom, 1)
    assert.equal(loaded.masterVolume, 1)
    assert.equal(loaded.loopEnabled, false)
    assert.ok(notes.some((n) => n.includes('capcraft-8k-mega')), JSON.stringify(notes))
    assert.equal(notes.filter((n) => n.includes('defaulted')).length, 4)
  })

  it('defaultExportConfigForPreset honors known presets without notes', () => {
    const notes: string[] = []
    const cfg = defaultExportConfigForPreset('youtube', 30, notes)
    assert.equal(cfg.preset, 'youtube')
    assert.equal(cfg.fps, 30)
    assert.deepEqual(notes, [])
  })
})

describe('large project + unicode filenames (Phase 6/9 hardening)', () => {
  before(async () => {
    // Fresh dir per suite (legacy suite cleans its own).
  })

  it('500 clips round-trip with identity (manifest dedups shared files)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'clipzu-large-'))
    try {
      const files: string[] = []
      for (let i = 0; i < 5; i++) {
        files.push(await writeFakeMedia(dir, `shared${i}.mp4`))
      }
      const clips = Array.from({ length: 500 }, (_, i) =>
        clipFor(files[i % files.length], `clip_${i}`, i * 1000)
      )
      const started = Date.now()
      const v1 = validateProjectFile(v1Payload(clips))
      assert.equal(v1.ok, true, JSON.stringify(v1.errors).slice(0, 500))
      const normalized = v1.data as NormalizedProjectFile
      const usages = normalized.clips.map((c) => ({ path: c.path, sourceDurationMs: c.sourceDurationMs }))
      const { assets, pathToAssetId } = await buildAssetManifest(usages, dir)
      // 5 unique files -> 5 manifest assets despite 500 clips.
      assert.equal(assets.length, 5)
      const migration = migrateV1ToClipzuStrict(normalized, assets, pathToAssetId, 'test', EXPORT_CONFIG, [])
      assert.equal(migration.ok, true, JSON.stringify(migration.errors).slice(0, 500))
      const onDisk = JSON.parse(JSON.stringify(migration.document)) as unknown
      const diskCheck = validateClipzuFile(onDisk)
      assert.equal(diskCheck.ok, true, JSON.stringify(diskCheck.errors).slice(0, 500))
      const document = diskCheck.data as ClipzuDocument
      const { resolved } = await resolveAssetManifest(document.assets, dir)
      assert.equal(resolved.size, 5)
      const beforeMs = recalcTimelineDuration({
        clips: normalized.clips, audioTracks: normalized.audioTracks, textClips: normalized.textClips,
      })
      assert.equal(beforeMs, 500 * 1000)
      const elapsed = Date.now() - started
      assert.ok(elapsed < 60000, `large round-trip took ${elapsed}ms`)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('CJK / emoji / space / # / paren filenames survive manifest + resolve', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'clipzu-unicode-'))
    try {
      const names = [
        '你好世界.mp4',
        '🎬 première (final) #2.mp4',
        '日本語 テスト  spaces .mp4',
        '한국어-믹스_2024.mp4',
      ]
      const files: string[] = []
      for (const name of names) {
        files.push(await writeFakeMedia(dir, name))
      }
      const v1 = validateProjectFile(
        v1Payload(files.map((p, i) => clipFor(p, `clip_u${i}`, i * 1000)))
      )
      assert.equal(v1.ok, true, JSON.stringify(v1.errors))
      const normalized = v1.data as NormalizedProjectFile
      const usages = normalized.clips.map((c) => ({ path: c.path, sourceDurationMs: c.sourceDurationMs }))
      const { assets, pathToAssetId } = await buildAssetManifest(usages, dir)
      assert.equal(assets.length, 4)
      const migration = migrateV1ToClipzuStrict(normalized, assets, pathToAssetId, 'test', EXPORT_CONFIG, [])
      assert.equal(migration.ok, true, JSON.stringify(migration.errors))
      // No absolute path (incl. unicode) may leak onto disk.
      const serialized = JSON.stringify(migration.document)
      for (const p of files) {
        assert.ok(!serialized.includes(p), `absolute path leaked: ${p}`)
      }
      const document = validateClipzuFile(JSON.parse(serialized) as unknown).data as ClipzuDocument
      const { resolved } = await resolveAssetManifest(document.assets, dir)
      for (const clip of document.timeline.clips) {
        const live = resolved.get(clip.assetId) as string
        assert.ok(files.includes(live), `resolved path not byte-identical: ${live}`)
      }
      // Filenames (not just paths) survive byte-identically.
      const resolvedNames = [...resolved.values()].map((p) => p.split(/[\\/]/).pop()).sort()
      assert.deepEqual(resolvedNames, [...names].sort())
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
