/**
 * undo.inttest.ts — Undo structural-sharing regression tests.
 *
 * pushUndoSnapshot stores LIVE references instead of deep clones (O(1) per
 * edit). Safety rests on: every timeline mutation flows through immer set()
 * producers (audited — no out-of-producer writes), so committed state is
 * never mutated in place. These tests lock that contract:
 *
 * 1. Snapshots share references with live state (no clone).
 * 2. Later edits never leak into earlier snapshots (independence).
 * 3. Undo/redo round-trips restore exactly (HotkeyManager apply pattern).
 * 4. Snapshots are deep-frozen in non-production (violations throw loudly).
 * 5. A 2000-clip push completes fast (no O(n) clone allocations).
 *
 * Zero dependencies: node:test + node:assert only. Drives the REAL compiled
 * stores (same harness as lifecycle.inttest.ts).
 */

import './testSetup'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useTimeline, pushUndoSnapshot, captureTimelineSnapshot, performUndo, performRedo, getClipboard } = require('../../../renderer/store/useTimeline.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useProject } = require('../../../renderer/store/useProject.js')

const TRANSFORM = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
  cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
}

function seedOneClip(id = 'clip_1', startMs = 0): void {
  useTimeline.getState().clearTimeline()
  useProject.getState().loadProject({
    name: 'Undo Test',
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    aspectRatio: '16:9',
    backgroundColor: '#000000',
    projectFilePath: null,
  })
  useTimeline.getState().addClip({
    id,
    path: '/media/a.mp4',
    startMs,
    sourceDurationMs: 5000,
    durationMs: 3000,
    trackIndex: 0,
    trimStart: 0,
    trimEnd: 2000,
    name: 'A',
    hasAudio: true,
    transform: { ...TRANSFORM },
    speed: 1,
    volume: 1,
    muted: false,
    keyframes: [
      { property: 'opacity', frames: [{ time: 0, value: 0 }, { time: 3000, value: 100 }] },
    ],
    modifiers: [
      { id: 'm1', type: 'effect', presetId: 'contrast', enabled: true, parameters: { level: 20 }, keyframes: [], version: 1 },
    ],
  })
}

/** Replicates HotkeyManager's Ctrl+Z apply pattern exactly. */
function applyUndoSnapshot(snapshot: {
  clips: unknown[]; audioTracks: unknown[]; textClips: unknown[];
  tracks?: unknown[]; markers?: unknown[];
}): void {
  useTimeline.setState({
    clips: snapshot.clips as never,
    audioTracks: snapshot.audioTracks as never,
    textClips: snapshot.textClips as never,
    ...(snapshot.tracks ? { tracks: snapshot.tracks as never } : {}),
    ...(snapshot.markers ? { markers: snapshot.markers as never } : {}),
  })
  useTimeline.getState().recalcTotalDuration()
}

describe('undo structural sharing', () => {
  beforeEach(() => {
    seedOneClip()
  })

  it('snapshots share references with live state (no deep clone)', () => {
    pushUndoSnapshot()
    const live = useTimeline.getState()
    const stack = useProject.getState().undoStack as Array<{ clips: unknown[] }>
    const top = stack[stack.length - 1]
    assert.equal(top.clips, live.clips as unknown)
    assert.equal(top.clips[0], live.clips[0] as unknown)
  })

  it('later edits never leak into earlier snapshots', () => {
    pushUndoSnapshot()
    const stack = useProject.getState().undoStack as Array<{
      clips: Array<{ startMs: number; keyframes?: Array<{ frames: Array<{ value: number }> }> }>
    }>
    const snapClip = stack[stack.length - 1].clips[0]
    useTimeline.getState().moveClip('clip_1', 1500)
    // Live moved; snapshot pristine — including nested keyframes/modifiers.
    assert.equal(useTimeline.getState().clips[0].startMs, 1500)
    assert.equal(snapClip.startMs, 0)
    assert.equal(snapClip.keyframes?.[0].frames[1].value, 100)
  })

  it('undo/redo round-trips restore exactly (HotkeyManager pattern)', () => {
    pushUndoSnapshot()
    useTimeline.getState().moveClip('clip_1', 1500)
    // Mirror the centralized operations exactly (hotkeys + toolbar share them).
    assert.equal(performUndo(), true)
    assert.equal(useTimeline.getState().clips[0].startMs, 0)
    assert.deepEqual(
      useTimeline.getState().clips[0].modifiers,
      [{ id: 'm1', type: 'effect', presetId: 'contrast', enabled: true, parameters: { level: 20 }, keyframes: [], version: 1 }]
    )
    // Redo must restore the live-at-undo-time state (was a no-op bug: the
    // old model pushed the popped snapshot onto redo instead of current).
    assert.equal(performRedo(), true)
    assert.equal(useTimeline.getState().clips[0].startMs, 1500)
    // And undo again returns to the pre-edit state (redo stack feeds back).
    assert.equal(performUndo(), true)
    assert.equal(useTimeline.getState().clips[0].startMs, 0)
  })

  it('store-level undo/redo exchange current state correctly', () => {
    pushUndoSnapshot()
    useTimeline.getState().moveClip('clip_1', 1500)
    // Mirror HotkeyManager Ctrl+Z exactly: capture current, then pop.
    const snapshot = useProject.getState().undo(captureTimelineSnapshot())
    assert.ok(snapshot)
    applyUndoSnapshot(snapshot as never)
    assert.equal(useTimeline.getState().clips[0].startMs, 0)
    // Mirror Ctrl+Shift+Z: redo must restore the live-at-undo-time state.
    const redone = useProject.getState().redo(captureTimelineSnapshot())
    assert.ok(redone)
    applyUndoSnapshot(redone as never)
    assert.equal(useTimeline.getState().clips[0].startMs, 1500)
  })

  it('snapshots are deep-frozen outside production (violations throw)', () => {
    assert.notEqual(process.env.NODE_ENV, 'production')
    pushUndoSnapshot()
    const stack = useProject.getState().undoStack as Array<{
      clips: Array<{ startMs: number }>
    }>
    const snapClip = stack[stack.length - 1].clips[0]
    assert.equal(Object.isFrozen(snapClip), true)
    assert.throws(() => {
      ;(snapClip as { startMs: number }).startMs = 9999
    }, TypeError)
    // Live state untouched by the attempt.
    assert.equal(useTimeline.getState().clips[0].startMs, 0)
  })

  it('shares across stacked entries without cross-contamination', () => {
    pushUndoSnapshot() // A: startMs 0
    useTimeline.getState().moveClip('clip_1', 100) // internal push B: 0
    pushUndoSnapshot() // C: startMs 100
    useTimeline.getState().moveClip('clip_1', 200) // internal push D: 100
    const stack = useProject.getState().undoStack as Array<{
      clips: Array<{ startMs: number }>
    }>
    // Tail is [..., B(0), C(100), D(100)] regardless of seed-time entries.
    assert.equal(stack[stack.length - 1].clips[0].startMs, 100)
    assert.equal(stack[stack.length - 2].clips[0].startMs, 100)
    assert.equal(stack[stack.length - 3].clips[0].startMs, 0)
    assert.equal(useTimeline.getState().clips[0].startMs, 200)
  })

  it('2000-clip push completes fast (no clone allocations)', () => {
    const clips = Array.from({ length: 2000 }, (_, i) => ({
      id: `clip_${i}`,
      path: '/media/a.mp4',
      startMs: i * 10,
      sourceDurationMs: 5000,
      durationMs: 3000,
      trackIndex: 0,
      trimStart: 0,
      trimEnd: 2000,
      transform: { ...TRANSFORM },
      speed: 1,
      volume: 1,
      muted: false,
      words: undefined,
    }))
    useTimeline.getState().loadTimeline({ clips: clips as never, audioTracks: [] })
    const started = Date.now()
    pushUndoSnapshot()
    const elapsed = Date.now() - started
    assert.ok(elapsed < 1000, `2000-clip push took ${elapsed}ms`)
    const stack = useProject.getState().undoStack as Array<{ clips: unknown[] }>
    assert.equal(stack[stack.length - 1].clips.length, 2000)
  })

  it('drag capture shares refs; cancelDrag restores exactly', () => {
    const st = useTimeline.getState()
    st.beginDragCapture()
    st.moveClip('clip_1', 777)
    assert.equal(useTimeline.getState().clips[0].startMs, 777)
    useTimeline.getState().cancelDrag()
    assert.equal(useTimeline.getState().clips[0].startMs, 0)
  })

  it('clipboard copy stays independent (still cloned — paste must not alias)', () => {
    useTimeline.getState().selectClip('clip_1')
    useTimeline.getState().copySelection()
    const clip = getClipboard() as { clips: Array<{ id: string }> } | null
    assert.ok(clip)
    assert.notEqual(clip.clips[0], useTimeline.getState().clips[0] as unknown)
  })
})
