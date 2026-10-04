import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildLaneLayout, computeSnapEdges, findClipsInBox, hitTest, snapToEdges } from '../../../renderer/timeline/interaction'
import type { AudioTrack, Clip, TextClip, Track } from '../../../renderer/store/useTimeline'

const tracks: Track[] = [
  { id: 'video_0', name: 'Video 1', kind: 'video', index: 0, muted: false, locked: false, hidden: false, solo: false },
  { id: 'video_1', name: 'Video 2', kind: 'video', index: 1, muted: false, locked: false, hidden: false, solo: false },
  { id: 'audio_0', name: 'Audio 1', kind: 'audio', index: 0, muted: false, locked: false, hidden: false, solo: false },
  { id: 'caption_0', name: 'Caption 1', kind: 'caption', index: 0, muted: false, locked: false, hidden: false, solo: false },
  { id: 'caption_1', name: 'Caption 2', kind: 'caption', index: 1, muted: false, locked: false, hidden: false, solo: false },
]
const clips: Clip[] = [
  { id: 'v0', name: 'v0', path: 'v0.mp4', startMs: 0, sourceDurationMs: 1000, durationMs: 1000, trimStart: 0, trimEnd: 0, trackIndex: 0, volume: 1, speed: 1, muted: false },
  { id: 'v1', name: 'v1', path: 'v1.mp4', startMs: 0, sourceDurationMs: 1000, durationMs: 1000, trimStart: 0, trimEnd: 0, trackIndex: 1, volume: 1, speed: 1, muted: false },
]
const audio: AudioTrack[] = [{ id: 'a0', name: 'sfx', path: 'sfx.mp3', startMs: 0, sourceDurationMs: 1000, durationMs: 1000, trackIndex: 0, volume: 1, muted: false, role: 'sfx', trimStart: 0, trimEnd: 0 }]
const captions: TextClip[] = [
  { id: 'c0', text: 'one', startMs: 0, endMs: 1000, durationMs: 1000, trackIndex: 0 },
  { id: 'c1', text: 'two', startMs: 0, endMs: 1000, durationMs: 1000, trackIndex: 1 },
]

describe('consolidated timeline geometry', () => {
  it('lays out video, audio, and caption rows using collapsed audio heights', () => {
    const lanes = buildLaneLayout(tracks, clips, audio, captions, [0])
    assert.deepEqual(lanes.map(({ trackKind, trackIndex }) => [trackKind, trackIndex]), [
      ['video', 0], ['video', 1], ['audio', 0], ['caption', 0], ['caption', 1],
    ])
    assert.equal(lanes[2].h, 12)
    assert.equal(lanes[3].y - lanes[2].y, lanes[2].h + 4)
  })

  it('hits collapsed audio and caption rows without leaking into the next row', () => {
    const lanes = buildLaneLayout(tracks, clips, audio, captions, [0])
    const audioY = lanes[2].y + 6
    assert.equal(hitTest(50, audioY, 0.1, -1000, lanes, clips, audio, captions).kind, 'audio-body')
    const captionY = lanes[4].y + 8
    const hit = hitTest(50, captionY, 0.1, -1000, lanes, clips, audio, captions)
    assert.equal(hit.kind, 'caption-body')
    assert.equal(hit.kind === 'caption-body' ? hit.id : '', 'c1')
    assert.equal(hitTest(50, lanes[2].y + lanes[2].h + 1, 0.1, -1000, lanes, clips, audio, captions).kind, 'empty')
  })

  it('box-selects across lane kinds and treats touching edges as non-overlap', () => {
    const lanes = buildLaneLayout(tracks, clips, audio, captions)
    assert.deepEqual(findClipsInBox({ x1: -1, y1: -1, x2: 200, y2: 400 }, 0.1, lanes, clips, audio, captions), ['v0', 'v1', 'a0', 'c0', 'c1'])
    assert.deepEqual(findClipsInBox({ x1: 100, y1: 0, x2: 101, y2: lanes[0].h }, 0.1, lanes, clips, audio, captions), [])
  })

  it('uses logical timeline positions for snap edges regardless of zoom', () => {
    const edges = computeSnapEdges(clips, audio, captions, [], 5000)
    const atLowZoom = snapToEdges(1005, edges, new Set(['v0', 'v1', 'a0', 'c0', 'c1']), 0.1)
    const atHighZoom = snapToEdges(1005, edges, new Set(['v0', 'v1', 'a0', 'c0', 'c1']), 0.2)
    assert.equal(atLowZoom.snappedMs, 1005)
    assert.equal(atHighZoom.snappedMs, 1005)
    assert.equal(snapToEdges(1005, edges, new Set(), 0.1).snappedMs, 1000)
  })
})
