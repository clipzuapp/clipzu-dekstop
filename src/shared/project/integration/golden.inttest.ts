/**
 * golden.inttest.ts — Golden-frame export parity tests (REAL ffmpeg binary).
 *
 * Task.txt Phase 7: "What user sees in preview = what export produces."
 * These tests drive FFmpegService.buildExportCommand with realistic params,
 * execute the generated command against the bundled ffmpeg, and read back
 * PIXELS to assert each effect/keyframe/opacity path actually reaches the
 * encoder and behaves as Preview's CSS equivalent would:
 *
 *   brightness(+100)  -> brighter (near white)
 *   brightness(-100)  -> black
 *   grayscale(100)    -> channels equalized
 *   invert(100)       -> channel-inverted
 *   opacity 0.5       -> dimmed toward the black base
 *   blend darken      -> red over blue = black (non-normal blend path)
 *
 * The pure graph/command logic is covered in exportGraph.inttest.ts; this is
 * the end-to-end "does the bytes change as expected" proof. Skips (not fails)
 * if the bundled ffmpeg is absent.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FFmpegService, type ClipTransformExport } from '../../../main/services/FFmpegService'
import { buildExportGraph, type SlideGeometry, type ZoomGeometry } from '../../export/exportGraph'

const FFMPEG = join(
  process.cwd(),
  'resources',
  'bin',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
)
const HAS_FFMPEG = existsSync(FFMPEG)

let workDir = ''
let redClip = ''
let blueClip = ''
let grayClip = ''

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

async function makeSolid(file: string, color: string): Promise<void> {
  const res = await run(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:d=1:r=30`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-t', '1',
    file,
  ])
  assert.equal(res.code, 0, res.stderr)
}

/**
 * Read the top-left pixel of an 8x8 crop at (8,8) of the first frame as RGB.
 * Named crop params (w= h= x= y=) — this ffmpeg build rejects positional
 * `crop=8:8:8:8` with a bogus "width 0" error.
 */
async function firstPixel(file: string): Promise<[number, number, number]> {
  const res = await run(FFMPEG, [
    '-v', 'error', '-i', file,
    '-frames:v', '1', '-vf', 'crop=w=8:h=8:x=8:y=8',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ])
  assert.equal(res.code, 0, res.stderr)
  assert.ok(res.stdout.length >= 3, `expected >=3 bytes, got ${res.stdout.length}`)
  return [res.stdout[0], res.stdout[1], res.stdout[2]]
}

/** Read a pixel at (x,y) from the frame ~timeMs into the file. */
async function pixelAt(
  file: string,
  x: number,
  y: number,
  timeMs: number
): Promise<[number, number, number]> {
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

interface Scenario {
  /** Static effect filters from buildExportGraph (ffmpeg fragments). */
  videoFilters?: string[][]
  opacity?: number
  blobs?: (string | null)[]
  /** Slide geometry from buildExportGraph (per clip). */
  slideOut?: (SlideGeometry | null)[]
  slideIn?: (SlideGeometry | null)[]
  /** Zoom geometry from buildExportGraph (per clip). */
  zoomOut?: (ZoomGeometry | null)[]
  zoomIn?: (ZoomGeometry | null)[]
  clipStartMs?: number[]
  clipDurationMs?: number[]
  totalDurationMs?: number
  label: string
}

/** Build + run an export command for the given scenario, return output path. */
async function exportScenario(scenario: Scenario, clipPaths: string[]): Promise<string> {
  const svc = new FFmpegService(FFMPEG)
  const outputPath = join(workDir, `${scenario.label}.mp4`)
  const args = svc.buildExportCommand({
    clipPaths,
    clipTrackIndices: clipPaths.map(() => 0),
    clipHasAudio: clipPaths.map(() => false),
    clipTransforms: clipPaths.map((_, i) => ({
      ...IDENTITY,
      opacity: i === 0 ? (scenario.opacity ?? 1) : 1,
    })),
    clipVolumes: clipPaths.map(() => ({ volume: 1, muted: false })),
    clipStartMs: scenario.clipStartMs ?? clipPaths.map(() => 0),
    clipDurationMs: scenario.clipDurationMs ?? clipPaths.map(() => 1000),
    clipTrimStarts: clipPaths.map(() => 0),
    clipSpeeds: clipPaths.map(() => 1),
    clipVideoFilters: scenario.videoFilters ?? clipPaths.map(() => []),
    clipBlends: scenario.blobs ?? clipPaths.map(() => null),
    clipSlideOut: scenario.slideOut,
    clipSlideIn: scenario.slideIn,
    clipZoomOut: scenario.zoomOut,
    clipZoomIn: scenario.zoomIn,
    audioTracks: [],
    srtPath: null,
    captionStyle: null,
    outputWidth: 64,
    outputHeight: 64,
    projectWidth: 64,
    projectHeight: 64,
    fps: 30,
    codec: 'h264',
    qualityPreset: 'fast',
    totalDurationMs: scenario.totalDurationMs ?? 1000,
    outputPath,
  })
  const full = [FFMPEG, ...args]
  const res = await run(full[0], full.slice(1))
  assert.equal(res.code, 0, res.stderr.slice(-800))
  return outputPath
}

describe('golden-frame export parity (real ffmpeg)', { skip: !HAS_FFMPEG }, () => {
  before(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-golden-'))
    redClip = join(workDir, 'red.mp4')
    blueClip = join(workDir, 'blue.mp4')
    grayClip = join(workDir, 'gray.mp4')
    await makeSolid(redClip, 'red')
    await makeSolid(blueClip, 'blue')
    await makeSolid(grayClip, 'gray')
  })

  after(async () => {
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('baseline: identity transform preserves the source color', async () => {
    const out = await exportScenario({ label: 'baseline' }, [redClip])
    const [r, g, b] = await firstPixel(out)
    assert.ok(r > 200 && g < 40 && b < 40, `expected red, got ${r},${g},${b}`)
  })

  it('brightness +100 multiplies toward white (CSS brightness parity)', async () => {
    const out = await exportScenario(
      { label: 'bright-up', videoFilters: [[`colorchannelmixer=rr=2.0000:gg=2.0000:bb=2.0000`]] },
      [grayClip]
    )
    const [r, g, b] = await firstPixel(out)
    assert.ok(r > 220 && g > 220 && b > 220, `expected white, got ${r},${g},${b}`)
  })

  it('brightness -100 multiplies to black (CSS brightness parity)', async () => {
    const out = await exportScenario(
      { label: 'bright-down', videoFilters: [[`colorchannelmixer=rr=0:gg=0:bb=0`]] },
      [grayClip]
    )
    const [r, g, b] = await firstPixel(out)
    assert.ok(r < 20 && g < 20 && b < 20, `expected black, got ${r},${g},${b}`)
  })

  it('brightness is multiplicative: red stays red at +100 (not additive luma)', async () => {
    const out = await exportScenario(
      { label: 'bright-red', videoFilters: [[`colorchannelmixer=rr=2.0000:gg=2.0000:bb=2.0000`]] },
      [redClip]
    )
    const [r, g, b] = await firstPixel(out)
    // CSS brightness(2) on red = red (channels scale, g/b stay 0). The old
    // additive eq mapping wrongly washed red toward pink.
    assert.ok(r > 200 && g < 40 && b < 40, `expected red, got ${r},${g},${b}`)
  })

  it('grayscale equalizes channels (Preview saturation:0 parity)', async () => {
    const out = await exportScenario(
      { label: 'grayscale', videoFilters: [[`eq=saturation=0`]] },
      [redClip]
    )
    const [r, g, b] = await firstPixel(out)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    assert.ok(max - min < 12, `expected gray, got ${r},${g},${b}`)
  })

  it('invert channel-inverts (negate)', async () => {
    const out = await exportScenario(
      { label: 'invert', videoFilters: [[`negate`]] },
      [redClip]
    )
    const [r, g, b] = await firstPixel(out)
    assert.ok(r < 40 && g > 200 && b > 200, `expected cyan, got ${r},${g},${b}`)
  })

  it('opacity 0.5 dims the clip toward the black base', async () => {
    const out = await exportScenario({ label: 'opacity-half', opacity: 0.5 }, [redClip])
    const [r, g, b] = await firstPixel(out)
    assert.ok(r > 80 && r < 180, `expected ~half red, got ${r},${g},${b}`)
    assert.ok(g < 40 && b < 40, `expected red hue retained, got ${r},${g},${b}`)
  })

  it('blend darken of red over blue -> dark (non-normal blend path)', async () => {
    // clip 0 = red (base track 0), clip 1 = blue with blend=darken.
    // buildExportCommand overlays track 0 normally, then blends track 1.
    const out = await exportScenario(
      { label: 'blend-darken', blobs: [null, 'darken'] },
      [redClip, blueClip]
    )
    const [r, g, b] = await firstPixel(out)
    // darken(red, blue) ~ black (small yuv rounding); the NORMAL overlay
    // path would retain blue (~255). All channels low proves blend applied.
    assert.ok(r < 80 && g < 80 && b < 80, `expected dark, got ${r},${g},${b}`)
  })

  it('normal overlay of blue over red retains blue (contrast for blend test)', async () => {
    const out = await exportScenario(
      { label: 'blend-normal', blobs: [null, null] },
      [redClip, blueClip]
    )
    const [r, g, b] = await firstPixel(out)
    assert.ok(b > 200 && r < 40, `expected blue overlay, got ${r},${g},${b}`)
  })

  it('generated command yields expected dimensions and duration', async () => {
    const out = await exportScenario({ label: 'dims' }, [redClip])
    // ffprobe via the service (probeExportOutput is dependency-light).
    const svc = new FFmpegService(FFMPEG)
    const probe = await svc.probeExportOutput(out)
    assert.equal(probe.hasVideo, true)
    assert.equal(probe.width, 64)
    assert.equal(probe.height, 64)
    assert.ok(Math.abs(probe.durationMs - 1000) < 250, `duration ${probe.durationMs}ms`)
  })

  it('slide-left transition: outgoing exits left, incoming enters from right', async () => {
    const graph = buildExportGraph({
      lanes: [{ kind: 'video', index: 0, muted: false, hidden: false, solo: false }],
      clips: [
        {
          path: redClip, startMs: 0, durationMs: 1000, trimStart: 0, speed: 1,
          volume: 1, muted: false, trackIndex: 0, transform: null,
          outTransition: { type: 'slide-left', durationMs: 500 },
        },
        {
          path: blueClip, startMs: 500, durationMs: 1000, trimStart: 0, speed: 1,
          volume: 1, muted: false, trackIndex: 0, transform: null,
        },
      ],
      audioTracks: [],
    })
    const out = await exportScenario(
      {
        label: 'slide-left',
        clipStartMs: [0, 500],
        clipDurationMs: [1000, 1000],
        totalDurationMs: 1500,
        slideOut: graph.clips.map((n) => n.slideOut),
        slideIn: graph.clips.map((n) => n.slideIn),
      },
      [redClip, blueClip]
    )
    // Midpoint (t=750ms): outgoing shifted -50% (left half red), incoming
    // shifted +50% (right half blue) — the signature of a slide, not a fade.
    const left = await pixelAt(out, 8, 8, 750)
    const right = await pixelAt(out, 56, 8, 750)
    assert.ok(left[0] > 180 && left[2] < 60, `expected red left, got ${left}`)
    assert.ok(right[2] > 180 && right[0] < 60, `expected blue right, got ${right}`)
    // Before the transition (t=100ms) the outgoing clip fills the frame.
    const pre = await pixelAt(out, 56, 8, 100)
    assert.ok(pre[0] > 180 && pre[2] < 60, `expected full red pre-transition, got ${pre}`)
  })

  it('zoom-out transition shrinks the outgoing clip (corners reveal the base)', async () => {
    const graph = buildExportGraph({
      lanes: [{ kind: 'video', index: 0, muted: false, hidden: false, solo: false }],
      clips: [
        {
          path: redClip, startMs: 0, durationMs: 1000, trimStart: 0, speed: 1,
          volume: 1, muted: false, trackIndex: 0, transform: null,
          outTransition: { type: 'zoom-out', durationMs: 500 },
        },
      ],
      audioTracks: [],
    })
    const out = await exportScenario(
      {
        label: 'zoom-out',
        clipStartMs: [0],
        clipDurationMs: [1000],
        totalDurationMs: 1000,
        zoomOut: graph.clips.map((n) => n.zoomOut),
        zoomIn: graph.clips.map((n) => n.zoomIn),
      },
      [redClip]
    )
    // Pre-transition: full red including the corner.
    const preCorner = await pixelAt(out, 2, 2, 200)
    assert.ok(preCorner[0] > 150, `expected red corner pre-transition, got ${preCorner}`)
    // Mid-transition: scaled to ~0.85 and faded, so the corner falls outside
    // the shrunk frame and shows the black base while the center stays red.
    const corner = await pixelAt(out, 2, 2, 750)
    const center = await pixelAt(out, 28, 28, 750)
    assert.ok(corner[0] < 60, `expected dark corner mid-zoom, got ${corner}`)
    assert.ok(center[0] > corner[0] + 40, `expected center brighter than corner, got ${center} vs ${corner}`)
  })
})
