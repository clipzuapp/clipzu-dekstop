/**
 * uiPrefs.inttest.ts — Phase 3 session-UI regression tests (roadmap P3).
 *
 * Covers:
 * - P3.1 pref defaults/merge/validation + storage round-trip (memory stub).
 * - P3.1 startup zoom order (remembered > smart default; file wins on load).
 * - P3.2 collapse truth table + toggle transitions + collapsed indices.
 * - P3.2 geometry: heights, cumulative Y, drag-row mapping, layout h,
 *       hit-test on collapsed rows, box-select with lane heights.
 * - P3.3 zoom math: single 1.25 step, zoom-to-fit (+clamp edges), smart
 *       default (+clamp edges).
 * - Override order via the REAL stores: setZoom persists, loadTimeline
 *       applies file zoom WITHOUT touching prefs storage.
 * - Portability: no UI-pref key appears in a validated save payload.
 *
 * Fixture policy (G4): synthetic data only. No story-39, no disk media.
 */

import './testSetup'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ZOOM_STEP,
  ZOOM_MIN,
  ZOOM_MAX,
  NARROW_WINDOW_PX,
  UI_PREFS_KEY,
  DEFAULT_UI_PREFS,
  applyZoomStep,
  zoomToFit,
  smartDefaultZoom,
  resolveStartupZoom,
  loadUiPrefs,
  saveUiPrefs,
  saveLastZoom,
  isAudioLaneCollapsed,
  toggleCollapseLane,
  resolveCollapsedAudioLanes,
  defaultStorage,
  type UiPrefs,
  type StorageLike,
} from '../../uiPrefs'
import { validateProjectFile } from '../projectSchema'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TL = require('../../../renderer/store/useTimeline.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PJ = require('../../../renderer/store/useProject.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LAY = require('../../../renderer/timeline/interaction.js')

function memStorage(seed?: Record<string, string>): StorageLike & { keys(): string[] } {
  const m = new Map<string, string>(Object.entries(seed ?? {}))
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k) as string : null),
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    keys: () => [...m.keys()],
  }
}

function prefs(over: Partial<UiPrefs> = {}): UiPrefs {
  return { ...DEFAULT_UI_PREFS, ...over }
}

describe('phase 3 — session UI prefs + zoom package', () => {
  describe('P3.1 prefs load/merge/validate', () => {
    it('empty storage yields defaults; narrow window seeds collapse default', () => {
      assert.deepEqual(loadUiPrefs(memStorage()), DEFAULT_UI_PREFS)
      assert.equal(loadUiPrefs(memStorage(), { narrowWindow: true }).collapseAudioByDefault, true)
      assert.equal(loadUiPrefs(memStorage(), { narrowWindow: false }).collapseAudioByDefault, false)
      assert.equal(loadUiPrefs(null).timelineZoom, null)
    })

    it('corrupt JSON, wrong shapes, and out-of-range numbers fall back per-field', () => {
      assert.deepEqual(loadUiPrefs(memStorage({ [UI_PREFS_KEY]: '{{{nope' })), DEFAULT_UI_PREFS)
      assert.deepEqual(loadUiPrefs(memStorage({ [UI_PREFS_KEY]: '"just a string"' })), DEFAULT_UI_PREFS)
      const loaded = loadUiPrefs(memStorage({
        [UI_PREFS_KEY]: JSON.stringify({
          timelineZoom: 999,
          collapsedAudioLanes: [0, -1, 1.9, 'x', null, 0],
          expandedAudioLanes: [1, 2],
          collapseAudioByDefault: 'yes',
          mediaPanelW: -50,
          inspectorW: 260.6,
          timelineH: Infinity,
          extraFutureKey: true,
        }),
      }))
      assert.equal(loaded.timelineZoom, null)
      // 1.9 floors to 1; negatives/strings/null drop; dupes collapse.
      assert.deepEqual(loaded.collapsedAudioLanes, [0, 1])
      // Expanded entries shadowed by collapsed are pruned.
      assert.deepEqual(loaded.expandedAudioLanes, [2])
      assert.equal(loaded.collapseAudioByDefault, false)
      assert.equal(loaded.mediaPanelW, null)
      assert.equal(loaded.inspectorW, 261)
      assert.equal(loaded.timelineH, null)
    })

    it('partial documents merge over defaults', () => {
      const loaded = loadUiPrefs(memStorage({
        [UI_PREFS_KEY]: JSON.stringify({ timelineZoom: 2 }),
      }))
      assert.equal(loaded.timelineZoom, 2)
      assert.deepEqual(loaded.collapsedAudioLanes, [])
      assert.equal(loaded.collapseAudioByDefault, false)
      assert.equal(loaded.mediaPanelW, null)
    })

    it('save round-trips; write failures return false without throwing', () => {
      const storage = memStorage()
      const input = prefs({
        timelineZoom: 1.75, collapsedAudioLanes: [1], expandedAudioLanes: [0],
        collapseAudioByDefault: true, mediaPanelW: 320, inspectorW: 280, timelineH: 220,
      })
      assert.equal(saveUiPrefs(input, storage), true)
      assert.deepEqual(loadUiPrefs(storage), input)
      assert.equal(saveUiPrefs(input, null), false)
      const refusing: StorageLike = {
        getItem: () => null,
        setItem: () => { throw new Error('denied') },
      }
      assert.equal(saveUiPrefs(input, refusing), false)
      assert.deepEqual(loadUiPrefs(refusing), DEFAULT_UI_PREFS)
    })

    it('saveLastZoom records valid zooms and ignores the rest', () => {
      const storage = memStorage()
      assert.equal(saveLastZoom(2.5, storage), true)
      assert.equal(loadUiPrefs(storage).timelineZoom, 2.5)
      assert.equal(saveLastZoom(NaN, storage), false)
      assert.equal(saveLastZoom(999, storage), false)
      assert.equal(loadUiPrefs(storage).timelineZoom, 2.5)
      assert.equal(saveLastZoom(1, null), false)
    })

    it('defaultStorage is null without a DOM (node:test safe)', () => {
      assert.equal(defaultStorage(), null)
    })
  })

  describe('P3.1 startup zoom order', () => {
    it('remembered zoom beats smart default; garbage falls back', () => {
      assert.equal(resolveStartupZoom(2, 1440), 2)
      assert.equal(resolveStartupZoom(0.02, 1440), 0.02)
      assert.equal(resolveStartupZoom(null, 1440), smartDefaultZoom(1440))
      assert.equal(resolveStartupZoom(999, 1440), smartDefaultZoom(1440))
      assert.equal(resolveStartupZoom(NaN, 1440), smartDefaultZoom(1440))
    })

    it('smart default fits 60s and clamps to [0.5, 2]', () => {
      // Typical windows all clamp to the floor (fitting 60s needs tiny zoom).
      assert.equal(smartDefaultZoom(1440), 0.5)
      assert.equal(smartDefaultZoom(1280), 0.5)
      assert.equal(smartDefaultZoom(500), 0.5)
      assert.equal(smartDefaultZoom(NaN), 0.5)
      // Wide windows resolve inside the window.
      assert.ok(Math.abs(smartDefaultZoom(3840) - (3840 - 640) / 6000) < 1e-9)
      assert.equal(smartDefaultZoom(20000), 2)
      assert.ok(NARROW_WINDOW_PX === 1400)
    })
  })

  describe('P3.3 zoom math', () => {
    it('single discrete step pins every zoom input to 1.25', () => {
      assert.equal(ZOOM_STEP, 1.25)
      assert.equal(applyZoomStep(1, 'in'), 1.25)
      assert.equal(applyZoomStep(1, 'out'), 0.8)
      assert.equal(applyZoomStep(2, 'in'), 2.5)
      assert.equal(applyZoomStep(0.8, 'in'), 1)
    })

    it('zoom-to-fit is exact with min/max clamps and empty guards', () => {
      assert.ok(Math.abs(zoomToFit(60000, 1312) - 1312 / 6000) < 1e-9)
      assert.equal(zoomToFit(60000, 1), ZOOM_MIN)
      assert.equal(zoomToFit(10, 100000), ZOOM_MAX)
      assert.equal(zoomToFit(0, 1000), 1)
      assert.equal(zoomToFit(-5, 1000), 1)
      assert.equal(zoomToFit(60000, 0), 1)
      assert.equal(zoomToFit(NaN, 1000), 1)
    })
  })

  describe('P3.2 collapse semantics', () => {
    it('truth table: explicit collapse > explicit expand > global default', () => {
      const off = prefs()
      assert.equal(isAudioLaneCollapsed(0, off), false)
      const on = prefs({ collapseAudioByDefault: true })
      assert.equal(isAudioLaneCollapsed(3, on), true)
      // Explicit expand survives the global default.
      const expanded = prefs({ collapseAudioByDefault: true, expandedAudioLanes: [3] })
      assert.equal(isAudioLaneCollapsed(3, expanded), false)
      assert.equal(isAudioLaneCollapsed(4, expanded), true)
      // Explicit collapse sticks even when the default is off.
      const collapsed = prefs({ collapsedAudioLanes: [1] })
      assert.equal(isAudioLaneCollapsed(1, collapsed), true)
      assert.equal(isAudioLaneCollapsed(0, collapsed), false)
    })

    it('toggle flips effective state and keeps the lists exclusive', () => {
      // Default off: toggle collapses explicitly.
      let p = toggleCollapseLane(prefs(), 2)
      assert.deepEqual(p.collapsedAudioLanes, [2])
      assert.deepEqual(p.expandedAudioLanes, [])
      // Toggling again expands explicitly.
      p = toggleCollapseLane(p, 2)
      assert.deepEqual(p.collapsedAudioLanes, [])
      assert.deepEqual(p.expandedAudioLanes, [2])
      // Default on: first toggle expands (does not no-op into collapsed).
      p = toggleCollapseLane(prefs({ collapseAudioByDefault: true }), 1)
      assert.deepEqual(p.collapsedAudioLanes, [])
      assert.deepEqual(p.expandedAudioLanes, [1])
      assert.equal(isAudioLaneCollapsed(1, p), false)
      assert.equal(isAudioLaneCollapsed(0, p), true)
      // Second toggle collapses explicitly; exclusivity holds.
      p = toggleCollapseLane(p, 1)
      assert.deepEqual(p.collapsedAudioLanes, [1])
      assert.deepEqual(p.expandedAudioLanes, [])
    })

    it('resolveCollapsedAudioLanes enumerates dense lanes only', () => {
      assert.deepEqual(resolveCollapsedAudioLanes(3, prefs({ collapseAudioByDefault: true })), [0, 1, 2])
      assert.deepEqual(resolveCollapsedAudioLanes(0, prefs({ collapseAudioByDefault: true })), [])
      assert.deepEqual(
        resolveCollapsedAudioLanes(4, prefs({ collapseAudioByDefault: true, expandedAudioLanes: [1] })),
        [0, 2, 3]
      )
    })
  })

  describe('P3.2 geometry (shared layout engine)', () => {
    const video = [{ kind: 'video', index: 0, muted: false, solo: false, hidden: false, locked: false, id: 'v', name: 'V' }]
    const audioClips = [
      { id: 'a0', path: '/m/0.mp3', startMs: 1000, sourceDurationMs: 5000, durationMs: 5000, volume: 1, muted: false, role: 'music', trimStart: 0, trimEnd: 0, trackIndex: 0 },
      { id: 'a1', path: '/m/1.mp3', startMs: 1000, sourceDurationMs: 5000, durationMs: 5000, volume: 1, muted: false, role: 'sfx', trimStart: 0, trimEnd: 0, trackIndex: 1 },
    ]

    it('audioLaneHeight + cumulative rows shrink collapsed lanes only', () => {
      assert.equal(LAY.audioLaneHeight(false), 36)
      assert.equal(LAY.audioLaneHeight(true), 12)
      // [video, audio0 open, audio1 collapsed, caption]
      const heights = LAY.timelineRowHeights(1, 2, 1, [1])
      assert.deepEqual(heights, [36, 36, 12, 36])
      assert.equal(LAY.rowYAt(heights, 0), 24)
      assert.equal(LAY.rowYAt(heights, 1), 24 + 40)
      assert.equal(LAY.rowYAt(heights, 2), 24 + 40 + 40)
      assert.equal(LAY.rowYAt(heights, 3), 24 + 40 + 40 + 16)
      assert.equal(LAY.rowsTotalHeight(heights), 24 + 40 + 40 + 16 + 40)
      // Expanded baseline is pixel-identical to the old fixed pitch.
      assert.deepEqual(LAY.timelineRowHeights(2, 2, 1, []), [36, 36, 36, 36, 36])
    })

    it('rowPositionAtY walks cumulative heights and clamps the tail', () => {
      const heights = [36, 36, 12, 36]
      assert.equal(LAY.rowPositionAtY(heights, 0), 0)
      assert.equal(LAY.rowPositionAtY(heights, 39), 0)
      assert.equal(LAY.rowPositionAtY(heights, 40), 1)
      assert.equal(LAY.rowPositionAtY(heights, 79), 1)
      assert.equal(LAY.rowPositionAtY(heights, 80), 2)
      assert.equal(LAY.rowPositionAtY(heights, 95), 2)
      assert.equal(LAY.rowPositionAtY(heights, 96), 3)
      assert.equal(LAY.rowPositionAtY(heights, 5000), 3)
      assert.equal(LAY.rowPositionAtY([], 10), 0)
    })

    it('buildLaneLayout carries per-lane heights (prefs object or index list)', () => {
      const byList = LAY.buildLaneLayout(video, [], audioClips, [], [1])
      const byPrefs = LAY.buildLaneLayout(video, [], audioClips, [], {
        collapsedAudioLanes: [1], expandedAudioLanes: [], collapseAudioByDefault: false,
      })
      const byDefault = LAY.buildLaneLayout(video, [], audioClips, [], {
        collapsedAudioLanes: [], expandedAudioLanes: [], collapseAudioByDefault: true,
      })
      for (const lanes of [byList, byPrefs]) {
        assert.deepEqual(lanes.map((l: { h: number }) => l.h), [36, 36, 12])
        assert.equal(lanes[2].y - lanes[1].y, 40)
        assert.equal(lanes[1].y - lanes[0].y, 40)
      }
      // Global default collapses every dense lane (narrow-window first run).
      assert.deepEqual(byDefault.map((l: { h: number }) => l.h), [36, 12, 12])
      const open = LAY.buildLaneLayout(video, [], audioClips, [])
      assert.deepEqual(open.map((l: { h: number }) => l.h), [36, 36, 36])
    })

    it('hit-test honors collapsed bounds (old 36px band no longer leaks)', () => {
      const lanes = LAY.buildLaneLayout(video, [], audioClips, [], [1])
      const ppm = 0.1
      // audio1 row spans canvasY 104..116 (12px). Middle hits the clip body.
      const hit = LAY.hitTest(200, 110, ppm, 0, lanes, [], audioClips, [])
      assert.equal(hit.kind, 'audio-body')
      assert.equal((hit as { id: string }).id, 'a1')
      // canvasY 124 sits inside the OLD 36px band but below the collapsed
      // row + gap: must NOT resolve to a1 anymore.
      const below = LAY.hitTest(200, 124, ppm, 0, lanes, [], audioClips, [])
      assert.notEqual((below as { id?: string }).id, 'a1')
    })

    it('box-select uses lane heights and reaches every caption lane', () => {
      const caps = [
        { id: 'c0', startMs: 1000, durationMs: 2000, endMs: 3000, trackIndex: 0, text: 'zero' },
        { id: 'c1', startMs: 1000, durationMs: 2000, endMs: 3000, trackIndex: 1, text: 'one' },
      ]
      const lanes = LAY.buildLaneLayout(video, [], audioClips, caps, [])
      const ppm = 0.1
      const laneY = (kind: string, idx: number): number => {
        const lane = lanes.find((l: { trackKind: string; trackIndex: number }) => l.trackKind === kind && l.trackIndex === idx)
        assert.ok(lane)
        return (lane as { y: number }).y
      }
      // Box over the lane-1 caption row only (x 50..350px => 500..3500ms).
      const y1 = laneY('caption', 1) - 24 + 2
      const ids = LAY.findClipsInBox(
        { x1: 50, y1, x2: 350, y2: y1 + 20 }, ppm, lanes, [], [], caps
      )
      assert.deepEqual(ids, ['c1'])
      // Box over both caption rows grabs both.
      const y0 = laneY('caption', 0) - 24 + 2
      const both = LAY.findClipsInBox(
        { x1: 50, y1: y0, x2: 350, y2: y1 + 20 }, ppm, lanes, [], [], caps
      )
      assert.deepEqual([...both].sort(), ['c0', 'c1'])
    })
  })

  describe('P3 override order + portability (real stores)', () => {
    beforeEach(() => {
      const { useTimeline } = TL as { useTimeline: { getState: () => { clearTimeline: () => void } } }
      useTimeline.getState().clearTimeline()
      ;(PJ.useProject.getState() as { loadProject: (d: Record<string, unknown>) => void }).loadProject({
        name: 'Prefs Test', fps: 30,
        resolution: { width: 1920, height: 1080 },
        aspectRatio: '16:9', backgroundColor: '#000000', projectFilePath: null,
      })
    })

    it('setZoom persists last zoom; loadTimeline applies file zoom without touching prefs', () => {
      const g = globalThis as { localStorage?: unknown }
      const prev = g.localStorage
      const storage = memStorage()
      g.localStorage = storage
      try {
        const tl = useTimelineShim()
        tl.setZoom(2.5)
        assert.equal(tl.getZoom(), 2.5)
        assert.equal(loadUiPrefs(storage).timelineZoom, 2.5)
        // Project load: file zoom wins the session, prefs untouched.
        tl.loadTimelineZoom(7)
        assert.equal(tl.getZoom(), 7)
        assert.equal(loadUiPrefs(storage).timelineZoom, 2.5)
      } finally {
        if (prev === undefined) delete g.localStorage
        else g.localStorage = prev
      }
    })

    it('no UI-pref key appears in a validated save payload (portability)', () => {
      const payload = {
        version: '1.0', name: 'Portable', fps: 30,
        resolution: { width: 1920, height: 1080 }, aspectRatio: '16:9', backgroundColor: '#000000',
        clips: [{
          id: 'clip_1', path: '/media/a.mp4', startMs: 0, sourceDurationMs: 5000,
          durationMs: 3000, trackIndex: 0, trimStart: 0, trimEnd: 2000, name: 'A',
          hasAudio: true,
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
            cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
          },
          speed: 1, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0,
        }],
        audioTracks: [], textClips: [],
        tracks: [
          { id: 'track_v0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false, solo: false },
        ],
        markers: [], exportPreset: 'youtube',
        captions: {
          entries: [],
          style: {
            fontFamily: 'Inter', fontSize: 48, fontWeight: 700, color: '#ffffff',
            strokeColor: '#000000', strokeWidth: 1, bgColor: '#000000', bgOpacity: 0.5,
            alignment: 'center', position: 'bottom', x: 50, y: 75, rotation: 0, scale: 1,
            animation: 'pop', captionMode: 'full-phrase', revealFadeMs: 0,
          },
          language: 'en',
        },
        playheadMs: 0, zoom: 2, masterVolume: 1, loopEnabled: false,
        exportConfig: {
          preset: 'youtube', customWidth: 1920, customHeight: 1080,
          upscaleEnabled: false, upscaleAlgorithm: 'lanczos', codec: 'h264', qualityPreset: 'slow',
          bitrateKbps: 8000, bitrateMode: 'cbr', exportFrameRange: null,
          audioOnly: false, fps: 30, hardwareAccel: false,
        },
      }
      const result = validateProjectFile(payload)
      assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors))
      const json = JSON.stringify(payload)
      for (const key of [
        'timelineZoom', 'collapsedAudioLanes', 'expandedAudioLanes',
        'collapseAudioByDefault', 'mediaPanelW', 'inspectorW', 'timelineH',
      ]) {
        assert.ok(!json.includes(`"${key}"`), `${key} leaked into save payload`)
      }
    })
  })
})

function useTimelineShim(): {
  setZoom: (z: number) => void
  getZoom: () => number
  loadTimelineZoom: (z: number) => void
} {
  const { useTimeline } = TL as {
    useTimeline: {
      getState: () => {
        zoom: number
        setZoom: (z: number) => void
        loadTimeline: (d: Record<string, unknown>) => void
      }
    }
  }
  return {
    setZoom: (z: number) => useTimeline.getState().setZoom(z),
    getZoom: () => useTimeline.getState().zoom,
    loadTimelineZoom: (z: number) => useTimeline.getState().loadTimeline({
      clips: [], audioTracks: [], zoom: z,
    }),
  }
}
