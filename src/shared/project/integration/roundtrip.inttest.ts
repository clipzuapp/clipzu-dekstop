/**
 * roundtrip.inttest.ts — .clipzu save→load identity integration test.
 *
 * Task.txt Step 2 item 4, exact scenario: Project A with 3 clips + audio +
 * text + keyframe + effect → save → reload → assert identical state.
 *
 * Zero dependencies: node:test + node:assert only (Node 18+). Runs against
 * COMPILED output (npm run test:project-format): the pure pipeline modules
 * (schema + assets + timeline duration) contain no Electron imports, so the
 * REAL production code is exercised — not a mock. The Electron IPC shell
 * (dialogs, app.getVersion) is excluded by construction and covered by the
 * manual QA checklist instead.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  validateProjectFile,
  validateClipzuFile,
  validateExportConfig,
  migrateV1ToClipzuStrict,
  type NormalizedProjectFile,
  type CanonicalExportConfig,
  type ClipzuDocument,
  type LoadedProjectFile,
} from '../projectSchema'
import {
  buildAssetManifest,
  resolveAssetManifest,
  MissingMediaError,
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
  bitrateKbps: 8000, bitrateMode: 'cbr',
  exportFrameRange: { startMs: 0, endMs: 9000 },
  audioOnly: false, fps: 30, hardwareAccel: true,
}

let workDir = ''
let mediaDir = ''
let clipPaths: string[] = []
let audioPath = ''

function textClips() {
  return [
    {
      id: 'text_1', startMs: 1000, durationMs: 2000, endMs: 3000, trackIndex: 0,
      text: 'hello world',
      style: { fontFamily: 'Inter', fontSize: 64 },
      words: [
        { word: 'hello', startMs: 1000, endMs: 1800 },
        { word: 'world', startMs: 1800, endMs: 3000 },
      ],
      wordTimestampsSource: 'whisper',
      fadeInMs: 0, fadeOutMs: 0,
    },
  ]
}

function runtimePayload(): Record<string, unknown> {
  const texts = textClips()
  return {
    version: '1.0',
    name: 'Project A',
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    aspectRatio: '16:9',
    backgroundColor: '#000000',
    clips: [0, 1, 2].map((i) => ({
      id: `clip_${i + 1}`,
      path: clipPaths[i],
      startMs: i * 3000,
      sourceDurationMs: 5000,
      durationMs: 3000,
      trackIndex: 0,
      trimStart: 0,
      trimEnd: 2000,
      name: `Clip ${i + 1}`,
      hasAudio: true,
      transform: { ...FULL_TRANSFORM, opacity: i === 0 ? 0.5 : 1 },
      speed: 1,
      volume: 1,
      muted: false,
      fadeInMs: 250,
      fadeOutMs: 250,
      // Keyframe (clip 1) + effect modifier (clip 2).
      keyframes:
        i === 0
          ? [{ property: 'opacity', frames: [{ time: 0, value: 0.5, easing: 'linear' }, { time: 3000, value: 1, easing: 'easeOut' }] }]
          : [],
      modifiers:
        i === 1
          ? [{ id: 'mod_1', type: 'effect', presetId: 'fx-sharpen', enabled: true, parameters: { amount: 0.7 }, keyframes: [], version: 1 }]
          : [],
      outTransition: { type: 'fade', durationMs: 500 },
      blendMode: 'normal',
    })),
    audioTracks: [
      {
        id: 'audio_1', path: audioPath, startMs: 0, sourceDurationMs: 9000,
        durationMs: 9000, volume: 0.9, muted: false, name: 'Music',
        role: 'music', trimStart: 0, trimEnd: 0, trackIndex: 0,
        fadeInMs: 500, fadeOutMs: 500,
      },
    ],
    textClips: texts,
    tracks: [
      { id: 'track_v0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false, solo: false },
      { id: 'track_a0', index: 0, name: 'Audio 1', kind: 'audio', muted: false, locked: false, hidden: false, solo: false },
    ],
    markers: [{ id: 'mk_1', timeMs: 4500, label: 'chorus', color: '#ff0000' }],
    captions: { entries: texts, style: FULL_STYLE, language: 'en' },
    exportPreset: 'youtube',
    playheadMs: 4500,
    zoom: 2,
    masterVolume: 0.8,
    loopEnabled: true,
    exportConfig: EXPORT_CONFIG,
  }
}

/** Replicates main's load injection (resolve map → absolute paths). */
function injectPaths(document: ClipzuDocument, resolved: Map<string, string>): LoadedProjectFile {
  return {
    version: '2.0',
    name: document.metadata.name,
    fps: document.metadata.fps,
    resolution: { ...document.metadata.resolution },
    aspectRatio: document.metadata.aspectRatio,
    backgroundColor: document.metadata.backgroundColor,
    clips: document.timeline.clips.map((clip) => {
      const { assetId: _a, ...rest } = clip as unknown as Record<string, unknown> & { assetId: string }
      void _a
      return { ...(rest as object), path: resolved.get(clip.assetId) as string }
    }) as LoadedProjectFile['clips'],
    audioTracks: document.timeline.audioTracks.map((track) => {
      const { assetId: _a, ...rest } = track as unknown as Record<string, unknown> & { assetId: string }
      void _a
      return { ...(rest as object), path: resolved.get(track.assetId) as string }
    }) as LoadedProjectFile['audioTracks'],
    textClips: document.timeline.textClips.map((tc) => ({ ...tc })),
    tracks: document.tracks.map((t) => ({ ...t })),
    markers: document.timeline.markers.map((m) => ({ ...m })),
    captions: {
      entries: document.captions.entries.map((tc) => ({ ...tc })),
      style: { ...(document.captions.style as object) } as LoadedProjectFile['captions']['style'],
      language: document.captions.language,
    },
    playheadMs: document.settings.playheadMs,
    zoom: document.settings.zoom,
    masterVolume: document.settings.masterVolume,
    loopEnabled: document.settings.loopEnabled,
    exportConfig: { ...document.exportConfig },
  }
}

describe('clipzu save→load identity (task.txt Step 2)', () => {
  before(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-inttest-'))
    mediaDir = join(workDir, 'media')
    await fs.mkdir(mediaDir, { recursive: true })
    clipPaths = []
    for (let i = 0; i < 3; i++) {
      const file = join(mediaDir, `shot${i + 1}.mp4`)
      await fs.writeFile(file, Buffer.from(`fake-video-bytes-${i}-${Date.now()}`))
      clipPaths.push(file)
    }
    audioPath = join(mediaDir, 'music.mp3')
    await fs.writeFile(audioPath, Buffer.from(`fake-audio-bytes-${Date.now()}`))
  })

  after(async () => {
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('validates the runtime payload strictly (v1)', () => {
    const result = validateProjectFile(runtimePayload())
    assert.equal(result.ok, true, JSON.stringify(result.errors))
    assert.equal(result.data?.clips.length, 3)
  })

  it('save→serialize→parse→validate→resolve→inject restores identical state', async () => {
    const payload = runtimePayload()
    const v1 = validateProjectFile(payload)
    assert.equal(v1.ok, true)
    const normalized = v1.data as NormalizedProjectFile

    const exportCheck = validateExportConfig(
      (payload as Record<string, unknown>)['exportConfig']
    )
    assert.equal(exportCheck.ok, true)

    const projectDir = workDir
    const usages = [
      ...normalized.clips.map((c) => ({ path: c.path, sourceDurationMs: c.sourceDurationMs })),
      ...normalized.audioTracks.map((t) => ({ path: t.path, sourceDurationMs: t.sourceDurationMs })),
    ]
    const { assets, pathToAssetId } = await buildAssetManifest(usages, projectDir)
    assert.equal(assets.length, 4)
    for (const asset of assets) {
      assert.match(asset.hash, /^[0-9a-f]{64}$/)
      assert.ok(asset.relativePath.length > 0)
      assert.ok(asset.originalPath.length > 0)
    }

    const migration = migrateV1ToClipzuStrict(
      normalized, assets, pathToAssetId, '9.9.9-test', exportCheck.data as CanonicalExportConfig, []
    )
    assert.equal(migration.ok, true, JSON.stringify(migration.errors))
    const envelope = migration.document as ClipzuDocument

    // Disk round-trip: serialize → parse → strict validate.
    const onDisk = JSON.parse(JSON.stringify(envelope)) as unknown
    const diskCheck = validateClipzuFile(onDisk)
    assert.equal(diskCheck.ok, true, JSON.stringify(diskCheck.errors))
    const document = diskCheck.data as ClipzuDocument

    // No absolute media paths may survive on disk.
    const serialized = JSON.stringify(document)
    for (const p of [...clipPaths, audioPath]) {
      assert.ok(!serialized.includes(p), `absolute path leaked to disk: ${p}`)
    }

    const { resolved } = await resolveAssetManifest(document.assets, projectDir)
    assert.equal(resolved.size, 4)
    const loaded = injectPaths(document, resolved)

    // Task.txt assertions: counts, ids, duration, effects, keyframes, captions, export.
    assert.equal(loaded.clips.length, 3)
    assert.deepEqual(loaded.clips.map((c) => c.id), ['clip_1', 'clip_2', 'clip_3'])
    assert.deepEqual(loaded.clips.map((c) => c.path), clipPaths)
    assert.equal(loaded.audioTracks.length, 1)
    assert.equal(loaded.audioTracks[0].path, audioPath)
    const beforeMs = recalcTimelineDuration({
      clips: normalized.clips, audioTracks: normalized.audioTracks, textClips: normalized.textClips,
    })
    const afterMs = recalcTimelineDuration({
      clips: loaded.clips, audioTracks: loaded.audioTracks, textClips: loaded.textClips,
    })
    assert.equal(afterMs, beforeMs)
    assert.equal(afterMs, 9000)
    assert.deepEqual(loaded.clips[1].modifiers, normalized.clips[1].modifiers)
    assert.deepEqual(loaded.clips[0].keyframes, normalized.clips[0].keyframes)
    assert.deepEqual(loaded.textClips, normalized.textClips)
    assert.deepEqual(loaded.captions.entries, loaded.textClips)
    assert.deepEqual(loaded.captions.style, FULL_STYLE)
    assert.equal(loaded.captions.language, 'en')
    assert.deepEqual(loaded.exportConfig, EXPORT_CONFIG)
    assert.deepEqual(loaded.tracks, normalized.tracks)
    assert.deepEqual(loaded.markers, normalized.markers)
    assert.equal(loaded.playheadMs, 4500)
    assert.equal(loaded.zoom, 2)
    assert.equal(loaded.masterVolume, 0.8)
    assert.equal(loaded.loopEnabled, true)
  })

  it('stored clips never carry path or proxyPath (single-source assetId)', async () => {
    const v1 = validateProjectFile(runtimePayload())
    assert.equal(v1.ok, true)
    const normalized = v1.data as NormalizedProjectFile
    const usages = [
      ...normalized.clips.map((c) => ({ path: c.path, sourceDurationMs: c.sourceDurationMs })),
      ...normalized.audioTracks.map((t) => ({ path: t.path, sourceDurationMs: t.sourceDurationMs })),
    ]
    const { assets, pathToAssetId } = await buildAssetManifest(usages, workDir)
    const migration = migrateV1ToClipzuStrict(
      normalized, assets, pathToAssetId, '9.9.9-test', EXPORT_CONFIG, []
    )
    assert.equal(migration.ok, true)
    // proxyPath is dropped by design (machine-local cache, never stored).
    for (const clip of (migration.document as ClipzuDocument).timeline.clips) {
      assert.ok(!('proxyPath' in clip))
      assert.ok(!('path' in clip))
    }
  })

  it('non-2.0 documents are rejected (no legacy, no version fallback)', async () => {
    const v1 = validateProjectFile(runtimePayload())
    const normalized = v1.data as NormalizedProjectFile
    const usages = [
      ...normalized.clips.map((c) => ({ path: c.path, sourceDurationMs: c.sourceDurationMs })),
      ...normalized.audioTracks.map((t) => ({ path: t.path, sourceDurationMs: t.sourceDurationMs })),
    ]
    const { assets, pathToAssetId } = await buildAssetManifest(usages, workDir)
    const migration = migrateV1ToClipzuStrict(
      normalized, assets, pathToAssetId, '9.9.9-test', EXPORT_CONFIG, []
    )
    const downgraded = JSON.parse(JSON.stringify(migration.document)) as Record<string, unknown>
    downgraded['version'] = '1.0'
    const r = validateClipzuFile(downgraded)
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.path === 'version'))
  })

  it('missing media aborts resolution with every file listed (never partial)', async () => {
    const v1 = validateProjectFile(runtimePayload())
    const normalized = v1.data as NormalizedProjectFile
    const usages = [
      ...normalized.clips.map((c) => ({ path: c.path, sourceDurationMs: c.sourceDurationMs })),
      ...normalized.audioTracks.map((t) => ({ path: t.path, sourceDurationMs: t.sourceDurationMs })),
    ]
    const { assets } = await buildAssetManifest(usages, workDir)
    const goneDir = join(workDir, 'media-moved-away')
    await fs.rename(mediaDir, goneDir)
    try {
      await assert.rejects(
        resolveAssetManifest(assets, workDir),
        (err: unknown) => {
          assert.ok(err instanceof MissingMediaError)
          assert.equal((err as MissingMediaError).missing.length, 4)
          assert.ok((err as Error).message.includes('shot1.mp4'))
          assert.ok((err as Error).message.includes('music.mp3'))
          return true
        }
      )
    } finally {
      await fs.rename(goneDir, mediaDir)
    }
  })

  it('corruption is rejected with paths (tampered endMs, stored path, dropped asset)', () => {
    const tampered = runtimePayload() as Record<string, unknown>
    ;((tampered['textClips'] as Array<Record<string, unknown>>)[0]['endMs'] as number) = 1
    const r1 = validateProjectFile(tampered)
    assert.equal(r1.ok, false)
    assert.ok(r1.errors.some((e) => e.path.includes('endMs')))

    const legacy = runtimePayload() as Record<string, unknown>
    const legacyClip = (legacy['clips'] as Array<Record<string, unknown>>)[0]
    delete legacyClip['transform']
    assert.equal(validateProjectFile(legacy).ok, false)
  })
})
