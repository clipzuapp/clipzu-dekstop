/**
 * images.inttest.ts — Phase 4 image-layer regression tests (roadmap P4).
 *
 * Covers:
 * - P4.1 import gate: image extensions classify (all 6 + case), dialog
 *       filters include stills, real ffprobe still probe (0ms, dims, silent).
 * - P4.2 model: still default duration mapping; schema save→load round-trip
 *       with an image clip (still path, no audio) through the REAL pipeline.
 * - P4.4 export: graph node isStill flag; command carries
 *       `-loop 1 -framerate` for stills (and not for video); golden pixel
 *       proof — a 2s still export reads back non-black frames mid-file.
 *
 * Fixture policy (G4): generated fixtures only (ffmpeg lavfi red square).
 * Skips (not fails) without the bundled ffmpeg. Story-39 files are used as
 * READ-ONLY classification strings where named, never copied or written.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  IMAGE_EXTENSIONS,
  MEDIA_EXTENSIONS,
  STILL_IMAGE_DEFAULT_DURATION_MS,
  isImageFile,
  isSupportedMedia,
  isAudioFile,
  isVideoFile,
  resolveImportDurationMs,
  mediaDialogFilters,
  IMAGE_EXTS_REGEX,
  ACCEPTED_MEDIA_LABEL,
} from '../../media/extensions'
import { buildExportGraph } from '../../export/exportGraph'
import { FFmpegService, type ClipTransformExport } from '../../../main/services/FFmpegService'
import {
  validateProjectFile,
  validateClipzuFile,
  validateExportConfig,
  migrateV1ToClipzuStrict,
  type NormalizedProjectFile,
  type CanonicalExportConfig,
  type ClipzuDocument,
} from '../projectSchema'
import {
  buildAssetManifest,
  resolveAssetManifest,
} from '../../../main/project/projectAssets'

const FFMPEG = join(
  process.cwd(),
  'resources',
  'bin',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
)
const HAS_FFMPEG = existsSync(FFMPEG)

function run(
  bin: string,
  args: string[]
): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { windowsHide: true })
    const out: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => out.push(d))
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr }))
    proc.on('error', () => resolve({ code: -1, stdout: Buffer.alloc(0), stderr: 'spawn error' }))
  })
}

/** Solid-color 64x64 PNG still (P4 manual fixture, generated — never repo). */
async function makeStill(file: string, color: string): Promise<void> {
  const res = await run(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=30`,
    '-frames:v', '1', file,
  ])
  assert.equal(res.code, 0, res.stderr)
}

/** Pixel at (x,y) from the frame ~timeMs into a file (golden.inttest pattern). */
async function pixelAt(file: string, x: number, y: number, timeMs: number): Promise<[number, number, number]> {
  const res = await run(FFMPEG, [
    '-v', 'error',
    '-ss', (timeMs / 1000).toFixed(3),
    '-i', file,
    '-frames:v', '1', '-vf', `crop=w=8:h=8:x=${x}:y=${y}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ])
  assert.equal(res.code, 0, res.stderr)
  assert.ok(res.stdout.length >= 3, `expected >=3 bytes, got ${res.stdout.length}`)
  return [res.stdout[0], res.stdout[1], res.stdout[2]]
}

const IDENTITY: ClipTransformExport = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
  cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
}

const EXPORT_CONFIG: CanonicalExportConfig = {
  preset: 'youtube',
  customWidth: 1920, customHeight: 1080,
  upscaleEnabled: false, upscaleAlgorithm: 'lanczos',
  codec: 'h264', qualityPreset: 'slow',
  bitrateKbps: 8000, bitrateMode: 'cbr',
  exportFrameRange: null, audioOnly: false, fps: 30, hardwareAccel: false,
}

const LANES = [{ kind: 'video', index: 0, muted: false, hidden: false, solo: false }] as const

let workDir = ''
let redStill = ''

describe('phase 4 — image layer end-to-end', () => {
  describe('P4.1 import gate', () => {
    it('all still extensions classify (supported, image-only, case-insensitive)', () => {
      assert.deepEqual([...IMAGE_EXTENSIONS].sort(), ['bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'])
      assert.equal(STILL_IMAGE_DEFAULT_DURATION_MS, 3000)
      for (const ext of IMAGE_EXTENSIONS) {
        assert.equal(isImageFile(`still.${ext}`), true, ext)
        assert.equal(isImageFile(`STILL.${ext.toUpperCase()}`), true, ext)
        assert.equal(isSupportedMedia(`still.${ext}`), true, ext)
        assert.equal(isAudioFile(`still.${ext}`), false, ext)
        assert.equal(isVideoFile(`still.${ext}`), false, ext)
        assert.equal(IMAGE_EXTS_REGEX.test(`still.${ext}`), true, ext)
      }
      // Non-stills stay non-stills (story-39 names as strings only).
      assert.equal(isImageFile('vid/3.mp4'), false)
      assert.equal(isImageFile('crunchy.mp3'), false)
      assert.equal(isImageFile("I made an air fryer in ancient China. It didn't go well.srt"), false)
      assert.equal(isImageFile('no-extension'), false)
      assert.ok(ACCEPTED_MEDIA_LABEL.includes('png'))
    })

    it('native dialog + relink filters accept stills (shared SSOT)', () => {
      const [media] = mediaDialogFilters()
      for (const ext of IMAGE_EXTENSIONS) {
        assert.ok((media.extensions as string[]).includes(ext), ext)
      }
      assert.ok((MEDIA_EXTENSIONS as readonly string[]).includes('png'))
    })

    it('default-duration mapping: stills take 3000, timed media keeps probe', () => {
      assert.equal(resolveImportDurationMs(true, 0), 3000)
      assert.equal(resolveImportDurationMs(true, 5000), 3000)
      assert.equal(resolveImportDurationMs(true, null), 3000)
      assert.equal(resolveImportDurationMs(false, 5040), 5040)
      assert.equal(resolveImportDurationMs(false, 5040.7), 5041)
      assert.equal(resolveImportDurationMs(false, null), 0)
      assert.equal(resolveImportDurationMs(false, undefined), 0)
      assert.equal(resolveImportDurationMs(false, NaN), 0)
    })
  })

  describe('P4.1 still probe + P4.2 save→load identity', { skip: !HAS_FFMPEG }, () => {
    before(async () => {
      workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-images-'))
      redStill = join(workDir, 'still-red.png')
      await makeStill(redStill, 'red')
    })

    after(async () => {
      await fs.rm(workDir, { recursive: true, force: true })
    })

    it('ffprobe still: 0ms duration with dimensions, no audio (no probe change needed)', async () => {
      const svc = new FFmpegService(FFMPEG)
      const info = await svc.getMediaInfo(redStill)
      assert.equal(info.durationMs, 0)
      assert.equal(info.width, 64)
      assert.equal(info.height, 64)
      assert.equal(info.hasAudio, false)
    })

    it('image clip survives save→load→resolve identity (still path, no audio)', async () => {
      const payload = {
        version: '1.0', name: 'Stills', fps: 30,
        resolution: { width: 1920, height: 1080 }, aspectRatio: '16:9', backgroundColor: '#000000',
        clips: [{
          id: 'clip_still', path: redStill, startMs: 0,
          sourceDurationMs: STILL_IMAGE_DEFAULT_DURATION_MS,
          durationMs: STILL_IMAGE_DEFAULT_DURATION_MS,
          trackIndex: 1, trimStart: 0, trimEnd: 0, name: 'Still',
          hasAudio: false,
          transform: { ...IDENTITY },
          speed: 1, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0,
        }],
        audioTracks: [], textClips: [],
        tracks: [
          { id: 'track_v0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false, solo: false },
          { id: 'track_v1', index: 1, name: 'Video 2', kind: 'video', muted: false, locked: false, hidden: false, solo: false },
        ],
        markers: [], exportPreset: 'youtube',
        captions: {
          entries: [], style: {
            fontFamily: 'Inter', fontSize: 48, fontWeight: 700, color: '#ffffff',
            strokeColor: '#000000', strokeWidth: 1, bgColor: '#000000', bgOpacity: 0.5,
            alignment: 'center', position: 'bottom', x: 50, y: 75, rotation: 0, scale: 1,
            animation: 'pop', captionMode: 'full-phrase', revealFadeMs: 0,
          }, language: 'en',
        },
        playheadMs: 0, zoom: 1, masterVolume: 1, loopEnabled: false,
        exportConfig: EXPORT_CONFIG,
      }
      const v1 = validateProjectFile(payload)
      assert.equal(v1.ok, true, JSON.stringify((v1 as { errors?: unknown }).errors))
      const normalized = v1.data as NormalizedProjectFile
      const exportCheck = validateExportConfig(
        (payload as Record<string, unknown>)['exportConfig']
      )
      assert.equal(exportCheck.ok, true)
      const usages = normalized.clips.map((c) => ({ path: c.path, sourceDurationMs: c.sourceDurationMs }))
      const { assets, pathToAssetId } = await buildAssetManifest(usages, workDir)
      assert.equal(assets.length, 1)
      const migration = migrateV1ToClipzuStrict(
        normalized, assets, pathToAssetId, '9.9.9-test', exportCheck.data as CanonicalExportConfig, []
      )
      assert.equal(migration.ok, true, JSON.stringify(migration.errors))
      const onDisk = JSON.parse(JSON.stringify(migration.document)) as unknown
      const diskCheck = validateClipzuFile(onDisk)
      assert.equal(diskCheck.ok, true, JSON.stringify(diskCheck.errors))
      const document = diskCheck.data as ClipzuDocument
      // No absolute still path survives on disk.
      assert.ok(!JSON.stringify(document).includes(redStill))
      const { resolved } = await resolveAssetManifest(document.assets, workDir)
      const loadedPath = resolved.get(document.timeline.clips[0].assetId)
      assert.equal(loadedPath, redStill)
      const loaded = document.timeline.clips[0]
      assert.equal(loaded.durationMs, STILL_IMAGE_DEFAULT_DURATION_MS)
      assert.equal((loaded as { hasAudio?: boolean }).hasAudio, false)
      assert.equal(loaded.trackIndex, 1)
    })
  })

  describe('P4.4 still export graph + command', () => {
    it('graph node flags stills (video stays false)', () => {
      const graph = buildExportGraph({
        lanes: [...LANES],
        clips: [
          {
            path: 'a.mp4', startMs: 0, durationMs: 2000, trimStart: 0, speed: 1,
            volume: 1, muted: false, hasAudio: true, trackIndex: 0, transform: null,
          },
          {
            path: 'still.png', startMs: 2000, durationMs: 3000, trimStart: 0, speed: 1,
            volume: 1, muted: false, hasAudio: false, trackIndex: 1, transform: null,
          },
        ],
        audioTracks: [],
      })
      assert.equal(graph.clips[0].isStill, false)
      assert.equal(graph.clips[1].isStill, true)
      // Stills resolve visibility/mute like video (no special-casing).
      assert.equal(graph.clips[1].visible, true)
    })

    it('export command loops still inputs (and only stills)', () => {
      const svc = new FFmpegService(FFMPEG)
      const base = {
        clipPaths: ['a.mp4', 'still.png'],
        clipTrackIndices: [0, 1],
        clipHasAudio: [false, false],
        clipTransforms: [{ ...IDENTITY }, { ...IDENTITY }],
        clipVolumes: [{ volume: 1, muted: false }, { volume: 1, muted: false }],
        clipStartMs: [0, 2000],
        clipDurationMs: [2000, 3000],
        clipTrimStarts: [0, 0],
        clipSpeeds: [1, 1],
        clipIsStill: [false, true],
        audioTracks: [],
        srtPath: null,
        captionStyle: null,
        outputWidth: 64, outputHeight: 64, projectWidth: 64, projectHeight: 64,
        fps: 30 as const, codec: 'h264' as const, qualityPreset: 'fast' as const,
        totalDurationMs: 5000, outputPath: join('out.mp4'),
      }
      const args = svc.buildExportCommand(base)
      const stillIdx = args.findIndex((a, i) =>
        a === '-loop' && args[i + 1] === '1' && args[i + 2] === '-framerate' && args[i + 3] === '30' &&
        args[i + 4] === '-i' && args[i + 5] === 'still.png')
      assert.ok(stillIdx >= 0, `looped still input missing in: ${args.slice(0, 12).join(' ')}`)
      // The video input is a bare -i (no loop).
      const videoIdx = args.findIndex((a, i) => a === '-i' && args[i + 1] === 'a.mp4')
      assert.ok(videoIdx >= 0)
      assert.notEqual(args[videoIdx - 4], '-loop')
    })
  })

  describe('P4.4 golden still export (real ffmpeg)', { skip: !HAS_FFMPEG }, () => {
    before(async () => {
      // Own fixture dir (never shared — prior suites clean up after themselves).
      workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-images-golden-'))
      redStill = join(workDir, 'still-red.png')
      await makeStill(redStill, 'red')
    })

    after(async () => {
      await fs.rm(workDir, { recursive: true, force: true })
      workDir = ''
    })

    it('2s still export reads back non-black frames mid-file', async () => {
      const svc = new FFmpegService(FFMPEG)
      const outputPath = join(workDir, 'still-2s.mp4')
      const args = svc.buildExportCommand({
        clipPaths: [redStill],
        clipTrackIndices: [0],
        clipHasAudio: [false],
        clipIsStill: [true],
        clipTransforms: [{ ...IDENTITY }],
        clipVolumes: [{ volume: 1, muted: false }],
        clipStartMs: [0],
        clipDurationMs: [2000],
        clipTrimStarts: [0],
        clipSpeeds: [1],
        audioTracks: [],
        srtPath: null,
        captionStyle: null,
        outputWidth: 64, outputHeight: 64, projectWidth: 64, projectHeight: 64,
        fps: 30,
        codec: 'h264', qualityPreset: 'fast',
        totalDurationMs: 2000,
        outputPath,
      })
      const res = await run(FFMPEG, args)
      assert.equal(res.code, 0, res.stderr.slice(-800))
      // First frame AND a mid-file frame are both the still (looped input,
      // not a single frame + black tail).
      for (const t of [100, 1000]) {
        const [r, g, b] = await pixelAt(outputPath, 8, 8, t)
        assert.ok(r > 200 && g < 60 && b < 60, `expected red at ${t}ms, got ${r},${g},${b}`)
      }
    })
  })
})
