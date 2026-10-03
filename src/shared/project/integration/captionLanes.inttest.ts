/**
 * captionLanes.inttest.ts — Phase 2 multi-lane caption regression tests.
 *
 * Covers (roadmap P2):
 * - Placement resolver matrix (clip/track/timeline/import/manual → lane).
 * - mapEntriesToTextClips: lane, source, style, deterministic ids, fades.
 * - importSRT lane override via the REAL stores.
 * - Per-lane save→load→render identity (validate→manifest→migrate→disk→
 *   resolve→inject) + buildLaneLayout/hit-test on two caption lanes.
 * - resolveActiveCaptions stacking order (preview stacking parity).
 * - Per-lane ASS burn-in (distinct styles, z layers) + time-ordered SRT.
 * - Lane mute/solo visibility (V2.2).
 * - Pinned story-39 expectation: SRT import to lane 1 → 36 TextClips on
 *   lane 1 (file blocks #28/#29 dropped), save→reload identical, ASS holds
 *   all 36 with the dropped texts absent.
 *
 * Fixture policy (G4): story-39 files are READ-ONLY and optional — the
 * story-39 test skips cleanly when CLIPZU_FIXTURES is absent; all other
 * tests use synthetic fixtures.
 */

import './testSetup'
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  firstFreeCaptionLane,
  usedCaptionLanes,
  laneForTranscribeClip,
  laneForTranscribeTrack,
  laneForTimelineTranscription,
  laneForSrtImport,
  laneForManualText,
  mapEntriesToTextClips,
  resolveActiveCaptions,
  captionLanePosition,
  captionAssLayer,
  isCaptionLaneVisible,
  visibleCaptionClips,
  sortCaptionsForExport,
  CAPTION_LANE_STACK_STEP_PCT,
  type CaptionLaneTrack,
} from '../../captions/lanes'
import { parseSRT, generateSRT, generateExportASS } from '../../utils/srt'
import type { CaptionStyle } from '../../types/caption'
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TL = require('../../../renderer/store/useTimeline.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PJ = require('../../../renderer/store/useProject.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CP = require('../../../renderer/store/useCaption.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LAYOUT = require('../../../renderer/timeline/interaction.js')

interface TestTextClip {
  id: string; startMs: number; durationMs: number; endMs: number
  trackIndex: number; text: string; style?: CaptionStyle
  words?: Array<{ word: string; startMs: number; endMs: number }>
  fadeInMs?: number; fadeOutMs?: number
}

interface TestTrack {
  id: string; index: number; kind: string; name: string
  muted: boolean; solo: boolean; locked: boolean; hidden: boolean
}

const useTimeline = TL.useTimeline as {
  getState: () => {
    clips: unknown[]
    audioTracks: unknown[]
    textClips: TestTextClip[]
    tracks: TestTrack[]
    clearTimeline: () => void
    addTextClip: (c: unknown) => void
    addTextClips: (c: unknown[]) => void
    loadTimeline: (d: Record<string, unknown>) => void
  }
}

const STYLE: CaptionStyle = {
  fontFamily: 'Inter', fontSize: 48, fontWeight: 700,
  color: '#ffffff', strokeColor: '#000000', strokeWidth: 1,
  bgColor: '#000000', bgOpacity: 0.5,
  alignment: 'center', position: 'bottom',
  x: 50, y: 75, rotation: 0, scale: 1,
  animation: 'pop', captionMode: 'full-phrase', revealFadeMs: 0,
}

/** Effective per-clip style (clip override over the suite default). */
function effStyle(clip: { style?: CaptionStyle }): CaptionStyle {
  return { ...STYLE, ...(clip.style ?? {}) }
}

const EXPORT_CONFIG: CanonicalExportConfig = {
  preset: 'youtube',
  customWidth: 1920, customHeight: 1080,
  upscaleEnabled: false, upscaleAlgorithm: 'lanczos',
  codec: 'h264', qualityPreset: 'slow',
  bitrateKbps: 8000, bitrateMode: 'cbr',
  exportFrameRange: null, audioOnly: false, fps: 30, hardwareAccel: false,
}

function resetProject(): void {
  useTimeline.getState().clearTimeline()
  ;(PJ.useProject.getState() as { loadProject: (d: Record<string, unknown>) => void }).loadProject({
    name: 'Caption Lanes Test',
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    aspectRatio: '16:9',
    backgroundColor: '#000000',
    projectFilePath: null,
  })
}

function seedTwoLanes(): void {
  resetProject()
  useTimeline.getState().addTextClips([
    { id: 'cap_a1', startMs: 1000, durationMs: 2000, endMs: 3000, trackIndex: 0, text: 'lane zero one', style: { ...STYLE }, fadeInMs: 0, fadeOutMs: 0 },
    { id: 'cap_a2', startMs: 4000, durationMs: 1000, endMs: 5000, trackIndex: 0, text: 'lane zero two', style: { ...STYLE }, fadeInMs: 0, fadeOutMs: 0 },
    { id: 'cap_b1', startMs: 1500, durationMs: 2000, endMs: 3500, trackIndex: 1, text: 'lane one one', style: { ...STYLE, color: '#ffff00' }, fadeInMs: 0, fadeOutMs: 0 },
  ])
}

describe('phase 2 — multi-lane auto captions', () => {
  describe('P2.1 placement resolvers', () => {
    it('first-free lane never silently returns an occupied lane 0', () => {
      assert.equal(firstFreeCaptionLane([]), 0)
      assert.equal(firstFreeCaptionLane([{ trackIndex: 0 }]), 1)
      assert.equal(firstFreeCaptionLane([{ trackIndex: 1 }]), 0)
      assert.equal(firstFreeCaptionLane([{ trackIndex: 0 }, { trackIndex: 1 }]), 2)
      assert.equal(firstFreeCaptionLane([{ trackIndex: 0 }, { trackIndex: 2 }]), 1)
      assert.deepEqual(usedCaptionLanes([{ trackIndex: 2 }, { trackIndex: 0 }, { trackIndex: 2 }]), [0, 2])
    })

    it('placement matrix: clip→source lane, track→lane i, timeline/file→first free, import→explicit-or-free, manual→first free', () => {
      // transcribeClip follows the source video clip's lane.
      assert.equal(laneForTranscribeClip(2), 2)
      assert.equal(laneForTranscribeClip(0), 0)
      // transcribeTrack(i) targets lane i.
      assert.equal(laneForTranscribeTrack(3), 3)
      // transcribeTimeline / single file take the first free lane.
      assert.equal(laneForTimelineTranscription([]), 0)
      assert.equal(laneForTimelineTranscription([{ trackIndex: 0 }]), 1)
      assert.equal(
        laneForTimelineTranscription([{ trackIndex: 0 }, { trackIndex: 1 }]),
        2
      )
      // SRT import: explicit lane wins, default is first free.
      assert.equal(laneForSrtImport([{ trackIndex: 0 }], 1), 1)
      assert.equal(laneForSrtImport([{ trackIndex: 0 }]), 1)
      assert.equal(laneForSrtImport([], 2), 2)
      // Manual text: first free, never silently 0 when occupied.
      assert.equal(laneForManualText([{ trackIndex: 0 }]), 1)
      assert.equal(laneForManualText([]), 0)
    })

    it('mapEntriesToTextClips stamps the resolved lane, source, style copy, deterministic ids, explicit fades', () => {
      const entries = [
        { startMs: 0, endMs: 1000, text: 'hello', words: [{ word: 'hello', startMs: 0, endMs: 1000 }], wordTimestampsSource: 'whisper' as const },
        { startMs: 1500, endMs: 2500, text: 'world' },
      ]
      const clips = mapEntriesToTextClips(entries, {
        trackIndex: 2,
        idPrefix: 'text_fixed',
        sourceId: 'track_2',
        sourceType: 'audioTrack',
        style: { ...STYLE },
        transcriptionJobId: 'job_1',
      })
      assert.equal(clips.length, 2)
      assert.deepEqual(clips.map((c) => c.id), ['text_fixed_0', 'text_fixed_1'])
      for (const c of clips) {
        assert.equal(c.trackIndex, 2)
        assert.equal(c.sourceId, 'track_2')
        assert.equal(c.sourceType, 'audioTrack')
        assert.equal(c.transcriptionJobId, 'job_1')
        assert.equal(c.fadeInMs, 0)
        assert.equal(c.fadeOutMs, 0)
      }
      assert.equal(clips[0].durationMs, 1000)
      assert.deepEqual(clips[0].words, [{ word: 'hello', startMs: 0, endMs: 1000 }])
      // Style is a copy — mutating the clip never leaks into the source.
      ;(clips[0].style as CaptionStyle).color = '#000000'
      assert.equal(STYLE.color, '#ffffff')
    })
  })

  describe('P2.1 importSRT lane routing (real stores)', () => {
    beforeEach(() => {
      resetProject()
    })

    it('defaults to first free and honors an explicit lane, one undo entry per import', () => {
      const srt = '1\n00:00:01,000 --> 00:00:02,000\none\n\n2\n00:00:03,000 --> 00:00:04,000\ntwo\n'
      CP.useCaption.getState().importSRT(srt)
      let clips = useTimeline.getState().textClips
      assert.equal(clips.length, 2)
      assert.ok(clips.every((c) => c.trackIndex === 0))
      // Second import piles onto the next free lane, not lane 0.
      CP.useCaption.getState().importSRT(srt)
      clips = useTimeline.getState().textClips
      assert.equal(clips.length, 4)
      assert.deepEqual(clips.slice(2).map((c) => c.trackIndex), [1, 1])
      // Explicit override.
      CP.useCaption.getState().importSRT(srt, 0)
      clips = useTimeline.getState().textClips
      assert.deepEqual(clips.slice(4).map((c) => c.trackIndex), [0, 0])
      // Per-lane track records exist for both lanes.
      const lanes = useTimeline.getState().tracks.filter((t) => t.kind === 'caption')
      assert.deepEqual(lanes.map((t) => t.index).sort((a, b) => a - b), [0, 1])
      // Undo removes exactly one import batch.
      assert.equal(TL.performUndo(), true)
      assert.equal(useTimeline.getState().textClips.length, 4)
    })
  })

  describe('P2.2 lane geometry (buildLaneLayout + hit-test)', () => {
    beforeEach(() => {
      seedTwoLanes()
    })

    it('emits one row per used caption lane after video/audio rows', () => {
      const s = useTimeline.getState()
      const lanes = LAYOUT.buildLaneLayout(s.tracks, s.clips, s.audioTracks, s.textClips)
      const captionLanes = lanes.filter((l: { trackKind: string }) => l.trackKind === 'caption')
      assert.equal(captionLanes.length, 2)
      assert.deepEqual(captionLanes.map((l: { trackIndex: number }) => l.trackIndex), [0, 1])
      // Caption rows come after all video/audio rows, 40px pitch.
      const lastNonCaption = Math.max(
        ...lanes.filter((l: { trackKind: string }) => l.trackKind !== 'caption')
          .map((l: { y: number }) => l.y)
      )
      assert.ok(captionLanes[0].y > lastNonCaption)
      assert.equal(captionLanes[1].y - captionLanes[0].y, 40)
    })

    it('hit-tests each caption on its own lane row only', () => {
      const s = useTimeline.getState()
      const lanes = LAYOUT.buildLaneLayout(s.tracks, s.clips, s.audioTracks, s.textClips)
      const ppm = 0.1
      const laneRow = (idx: number): number => {
        const lane = lanes.find(
          (l: { trackKind: string; trackIndex: number }) => l.trackKind === 'caption' && l.trackIndex === idx
        )
        assert.ok(lane, `caption lane ${idx} exists`)
        return (lane as { y: number }).y + 10
      }
      // cap_b1 (lane 1, 1500–3500ms) hits on the lane-1 row …
      const hit1 = LAYOUT.hitTest(200, laneRow(1), ppm, 0, lanes, s.clips, s.audioTracks, s.textClips)
      assert.equal(hit1.kind, 'caption-body')
      assert.equal((hit1 as { id: string }).id, 'cap_b1')
      // … but the same x on the lane-0 row hits the lane-0 entry instead …
      const hit0 = LAYOUT.hitTest(200, laneRow(0), ppm, 0, lanes, s.clips, s.audioTracks, s.textClips)
      assert.equal(hit0.kind, 'caption-body')
      assert.equal((hit0 as { id: string }).id, 'cap_a1')
      // … and empty space on a caption row hits empty (no cross-lane leak).
      const empty = LAYOUT.hitTest(600, laneRow(1), ppm, 0, lanes, s.clips, s.audioTracks, s.textClips)
      assert.equal(empty.kind, 'empty')
    })
  })

  describe('P2.3 stacking order + P2.2 visibility', () => {
    it('resolveActiveCaptions sorts by lane then time; endMs is exclusive', () => {
      const clips = [
        { id: 'b', startMs: 1500, endMs: 3500, trackIndex: 1 },
        { id: 'a', startMs: 1000, endMs: 3000, trackIndex: 0 },
        { id: 'c', startMs: 500, endMs: 1200, trackIndex: 0 },
      ]
      assert.deepEqual(resolveActiveCaptions(clips, 2000).map((c) => c.id), ['a', 'b'])
      // c ends exactly at 1200 → exclusive.
      assert.deepEqual(resolveActiveCaptions(clips, 1200).map((c) => c.id), ['a'])
      assert.deepEqual(resolveActiveCaptions(clips, 9000).map((c) => c.id), [])
    })

    it('lane 0 keeps its exact position; deeper lanes step off the anchor edge', () => {
      const bottom = { x: 50, y: 75, position: 'bottom' as const }
      assert.deepEqual(captionLanePosition(bottom, 0), { x: 50, y: 75 })
      assert.deepEqual(captionLanePosition(bottom, 1), { x: 50, y: 75 - CAPTION_LANE_STACK_STEP_PCT })
      const top = { x: 50, y: 10, position: 'top' as const }
      assert.deepEqual(captionLanePosition(top, 1), { x: 50, y: 10 + CAPTION_LANE_STACK_STEP_PCT })
      // Clamps keep text on canvas.
      assert.ok(captionLanePosition(bottom, 10).y >= 8)
      assert.ok(captionLanePosition(top, 10).y <= 92)
    })

    it('captionAssLayer puts the lower lane index on top', () => {
      assert.ok(captionAssLayer(0, 2) > captionAssLayer(1, 2))
      assert.ok(captionAssLayer(1, 2) > captionAssLayer(2, 2))
      assert.equal(captionAssLayer(0, 0), 0)
    })

    it('V2.2: mute drops one lane, solo isolates the other, hidden drops, missing record stays visible', () => {
      const clips = [
        { id: 'a', startMs: 0, endMs: 5000, trackIndex: 0 },
        { id: 'b', startMs: 0, endMs: 5000, trackIndex: 1 },
      ]
      const open = [
        { kind: 'caption', index: 0, muted: false, solo: false, hidden: false },
        { kind: 'caption', index: 1, muted: false, solo: false, hidden: false },
      ]
      assert.deepEqual(visibleCaptionClips(clips, open).map((c) => c.id), ['a', 'b'])
      // Mute lane 0 → only lane 1 survives.
      const muted0 = open.map((t) => (t.index === 0 ? { ...t, muted: true } : t))
      assert.deepEqual(visibleCaptionClips(clips, muted0).map((c) => c.id), ['b'])
      // Solo lane 1 → only lane 1 survives.
      const solo1 = open.map((t) => (t.index === 1 ? { ...t, solo: true } : t))
      assert.deepEqual(visibleCaptionClips(clips, solo1).map((c) => c.id), ['b'])
      // Hidden lane 1 → only lane 0 survives.
      const hidden1 = open.map((t) => (t.index === 1 ? { ...t, hidden: true } : t))
      assert.deepEqual(visibleCaptionClips(clips, hidden1).map((c) => c.id), ['a'])
      // A video solo never touches caption visibility (caption-scoped solo).
      const videoSolo = [...open, { kind: 'video', index: 0, muted: false, solo: true, hidden: false }]
      assert.deepEqual(visibleCaptionClips(clips, videoSolo).map((c) => c.id), ['a', 'b'])
      // Missing record (old file) → visible.
      assert.equal(isCaptionLaneVisible(0, []), true)
    })

    it('sortCaptionsForExport merges lanes in time order without mutating', () => {
      const clips = [
        { id: 'b', startMs: 1500, endMs: 3500, trackIndex: 1 },
        { id: 'a', startMs: 1000, endMs: 3000, trackIndex: 0 },
        { id: 'c', startMs: 1000, endMs: 1100, trackIndex: 1 },
      ]
      const sorted = sortCaptionsForExport(clips)
      assert.deepEqual(sorted.map((c) => c.id), ['a', 'c', 'b'])
      assert.deepEqual(clips.map((c) => c.id), ['b', 'a', 'c'])
      // SRT sidecar follows the merged order.
      const srt = generateSRT(sorted.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.id })))
      const order = [...srt.matchAll(/^(\d+)\n\d{2}:/gm)].map((m) => m[1])
      assert.deepEqual(order, ['1', '2', '3'])
      assert.ok(srt.indexOf('\na\n') < srt.indexOf('\nc\n'))
    })
  })

  describe('P2.4 per-lane ASS burn-in', () => {
    beforeEach(() => {
      seedTwoLanes()
    })

    it('two lanes yield distinct styles (distinct MarginV) and lane-0-on-top layers', () => {
      const s = useTimeline.getState()
      const ordered = sortCaptionsForExport(visibleCaptionClips(s.textClips, s.tracks))
      const maxLane = ordered.reduce((m, c) => Math.max(m, c.trackIndex), 0)
      const ass = generateExportASS(
        ordered.map((c) => {
          const base = effStyle(c)
          return {
            startMs: c.startMs,
            endMs: c.endMs,
            text: c.text,
            words: c.words,
            style: { ...base, ...captionLanePosition(base, c.trackIndex) },
            fadeInMs: c.fadeInMs ?? 0,
            fadeOutMs: c.fadeOutMs ?? 0,
            layer: captionAssLayer(c.trackIndex, maxLane),
          }
        }),
        { outputWidth: 1080, outputHeight: 1920, projectWidth: 1080, projectHeight: 1920, fallbackStyle: { ...STYLE } }
      )
      const styles = ass.split('\n').filter((l) => l.startsWith('Style: '))
      const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue: '))
      assert.equal(dialogues.length, 3)
      // Two lanes → two style variants with distinct vertical margins.
      const marginVs = new Set(styles.map((l) => l.split(',').slice(-3).join(',')))
      assert.ok(styles.length >= 2, `expected 2+ styles, got ${styles.length}`)
      assert.ok(marginVs.size >= 2, 'lanes must differ in vertical placement')
      // Layer column: lane 0 entries carry the higher layer (on top).
      // (Dialogue text carries ASS tag prefixes, so match the tail text.)
      const layerOf = (text: string): number => {
        const line = dialogues.find((d) => d.endsWith(text))
        assert.ok(line, `dialogue for "${text}" exists`)
        return Number((line as string).split(',')[0].split(': ')[1])
      }
      assert.ok(layerOf('lane zero one') > layerOf('lane one one'))
    })
  })

  describe('P2.5 per-lane track records + save→load identity', () => {
    beforeEach(() => {
      resetProject()
    })

    it('addTextClip(s) auto-creates one record per lane used; load backfills old files', () => {
      useTimeline.getState().addTextClip({ id: 't0', startMs: 0, durationMs: 1000, endMs: 1000, trackIndex: 2, text: 'x', fadeInMs: 0, fadeOutMs: 0 })
      let records = useTimeline.getState().tracks.filter((t) => t.kind === 'caption')
      assert.deepEqual(records.map((t) => t.index), [2])
      assert.equal(records[0].id, 'track_caption_2')
      // Old file shape (lane-0 clips, no caption record) loads + backfills.
      useTimeline.getState().loadTimeline({
        clips: [], audioTracks: [],
        textClips: [{ id: 'old', startMs: 0, durationMs: 1000, endMs: 1000, trackIndex: 0, text: 'old', fadeInMs: 0, fadeOutMs: 0 }],
        tracks: [{ id: 'track_v0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false, solo: false }],
        markers: [],
      })
      records = useTimeline.getState().tracks.filter((t) => t.kind === 'caption')
      assert.deepEqual(records.map((t) => t.index), [0])
      // Placement, text, and timing untouched by the backfill.
      assert.deepEqual(
        useTimeline.getState().textClips.map((c) => [c.trackIndex, c.text, c.startMs, c.endMs]),
        [[0, 'old', 0, 1000]]
      )
    })
  })

  describe('story-39 pinned end-to-end (P2 exit gate)', () => {
    let workDir = ''
    let mediaDir = ''
    let clipPath = ''
    let srtContent: string | null = null

    before(async () => {
      workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-captionlanes-'))
      mediaDir = join(workDir, 'media')
      await fs.mkdir(mediaDir, { recursive: true })
      clipPath = join(mediaDir, 'voice.mp4')
      await fs.writeFile(clipPath, Buffer.from(`fake-video-bytes-${Date.now()}`))
      // READ-ONLY fixture reference (G4); skip cleanly when absent.
      const fixtures = process.env.CLIPZU_FIXTURES ?? 'D:/work/Shu Lai Mu/content/uploaded_stories/story 39'
      const srtPath = join(fixtures, 'I made an air fryer in ancient China. It didn\'t go well.srt')
      if (existsSync(srtPath)) {
        srtContent = await fs.readFile(srtPath, 'utf-8')
      }
    })

    after(async () => {
      await fs.rm(workDir, { recursive: true, force: true })
    })

    it('SRT import to lane 1 yields exactly 36 TextClips on lane 1 (blocks #28/#29 absent)', () => {
      if (srtContent === null) {
        console.log('  (skip: CLIPZU_FIXTURES story-39 SRT absent)')
        return
      }
      resetProject()
      // Parser pin: 38 blocks → 36 entries (malformed-timestamp blocks #28/#29 dropped).
      const parsed = parseSRT(srtContent)
      assert.equal(parsed.length, 36)
      assert.equal(parsed.filter((e) => e.endMs <= e.startMs).length, 0)
      assert.ok(parsed.some((e) => e.text.includes('\'')))

      CP.useCaption.getState().importSRT(srtContent, 1)
      const clips = useTimeline.getState().textClips
      assert.equal(clips.length, 36)
      assert.ok(clips.every((c) => c.trackIndex === 1))
      // The dropped file blocks (#28 "shouting.", #29 "You just ruined") are absent.
      assert.ok(!clips.some((c) => c.text.trim() === 'shouting.'))
      assert.ok(!clips.some((c) => c.text.trim() === 'You just ruined'))
      // Per-lane record created for lane 1.
      const records = useTimeline.getState().tracks.filter((t) => t.kind === 'caption')
      assert.deepEqual(records.map((t) => t.index), [1])
    })

    it('two-lane save→reload is identical; ASS holds all 36 with per-lane placement', async () => {
      if (srtContent === null) {
        console.log('  (skip: CLIPZU_FIXTURES story-39 SRT absent)')
        return
      }
      resetProject()
      CP.useCaption.getState().importSRT(srtContent, 1)
      // Voice lane: second source on the first free lane (0).
      CP.useCaption.getState().importSRT('1\n00:00:02,000 --> 00:00:03,000\nvoiceover\n', undefined)
      const live = useTimeline.getState()
      assert.equal(live.textClips.length, 37)
      assert.deepEqual(usedCaptionLanes(live.textClips), [0, 1])

      // Save pipeline: validate → manifest → migrate → disk bytes.
      const payload = {
        version: '1.0',
        name: 'Caption Lanes',
        fps: 30,
        resolution: { width: 1080, height: 1920 },
        aspectRatio: '9:16',
        backgroundColor: '#000000',
        clips: [{
          id: 'clip_1', path: clipPath, startMs: 0, sourceDurationMs: 40000,
          durationMs: 40000, trackIndex: 0, trimStart: 0, trimEnd: 0,
          name: 'Voice', hasAudio: true,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
          speed: 1, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0,
        }],
        audioTracks: [],
        textClips: live.textClips.map((c) => ({ ...c })),
        tracks: live.tracks.map((t) => ({ ...t })),
        markers: [],
        exportPreset: 'tiktok-reels',
        captions: {
          entries: live.textClips.map((c) => ({ ...c })),
          style: { ...STYLE },
          language: 'en',
        },
        playheadMs: 0, zoom: 1, masterVolume: 1, loopEnabled: false,
        exportConfig: { ...EXPORT_CONFIG, preset: 'tiktok-reels' as const },
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
      const migration = migrateV1ToClipzuStrict(
        normalized, assets, pathToAssetId, '9.9.9-test', exportCheck.data as CanonicalExportConfig, []
      )
      assert.equal(migration.ok, true, JSON.stringify(migration.errors))
      const onDisk = JSON.parse(JSON.stringify(migration.document)) as unknown
      const diskCheck = validateClipzuFile(onDisk)
      assert.equal(diskCheck.ok, true, JSON.stringify(diskCheck.errors))
      const document = diskCheck.data as ClipzuDocument
      const { resolved } = await resolveAssetManifest(document.assets, workDir)
      assert.equal(resolved.size, 1)
      const loadedTextClips: TestTextClip[] = document.timeline.textClips.map((tc) => ({ ...(tc as object) }) as TestTextClip)
      const loadedCaptionLanes: number[] = (document.tracks as Array<{ kind: string; index: number }>)
        .filter((t) => t.kind === 'caption')
        .map((t) => t.index)
        .sort((a, b) => a - b)
      // Identity: lanes, placement, styles identical after reload.
      // Compared through JSON (disk reality): in-memory styles carry
      // explicit undefined keys (defaultStyle spread) that JSON drops.
      assert.deepEqual(
        JSON.parse(JSON.stringify(loadedTextClips)),
        JSON.parse(JSON.stringify(normalized.textClips))
      )
      assert.deepEqual(loadedCaptionLanes, [0, 1])

      // Export ASS over the reloaded state: all 37 dialogues, two lane
      // styles with distinct vertical placement, dropped texts absent.
      const ordered = sortCaptionsForExport(visibleCaptionClips(
        loadedTextClips,
        document.tracks as CaptionLaneTrack[]
      ))
      const maxLane = 1
      const ass = generateExportASS(
        ordered.map((c) => {
          const base = effStyle(c)
          return {
            startMs: c.startMs, endMs: c.endMs, text: c.text,
            words: c.words,
            style: { ...base, ...captionLanePosition(base, c.trackIndex) },
            fadeInMs: c.fadeInMs ?? 0, fadeOutMs: c.fadeOutMs ?? 0,
            layer: captionAssLayer(c.trackIndex, maxLane),
          }
        }),
        { outputWidth: 1080, outputHeight: 1920, projectWidth: 1080, projectHeight: 1920, fallbackStyle: { ...STYLE } }
      )
      const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue: '))
      assert.equal(dialogues.length, 37)
      assert.ok(!ass.includes(',shouting.'))
      assert.ok(!ass.includes(',You just ruined'))
      const styles = ass.split('\n').filter((l) => l.startsWith('Style: '))
      const marginVs = new Set(styles.map((l) => l.split(',').slice(-3).join(',')))
      assert.ok(marginVs.size >= 2, 'stacked preview == burned output needs per-lane placement')
    })
  })
})
