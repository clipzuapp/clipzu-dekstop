/**
 * tracks.inttest.ts — Phase 1 track/layer regression tests (roadmap P1).
 *
 * Drives the REAL compiled stores (same harness as undo/lifecycle inttests).
 * Covers:
 * - P1.1 deleteTrack cascade for ALL kinds + undo restores byte-identical.
 * - P1.2 moveAudioTrack lane change + computeEffectiveMuted follows parent;
 *       moveAudioTrackLive pushes no undo (drag path, no undo spam).
 * - P1.3 moveTrack swaps lanes WITH content + undo; edge no-op pushes nothing.
 * - P1.4 extension SSOT: identical sets incl. m4a; story-39 filenames classify.
 * - P1.5 rename path uses store actions with undo (dialog itself is manual QA).
 * - P1.6 clearQueue keeps running/pending, clears finished history.
 * - addTrack index after deletes never collides; toggles validate via schema.
 *
 * Fixture policy (G4): synthetic paths only. Story-39 filenames are used as
 * STRINGS for classification — never touched on disk.
 */

import './testSetup'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { validateProjectFile } from '../projectSchema'
import {
  MEDIA_EXTENSIONS,
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
  isSupportedMedia,
  isAudioFile,
  isVideoFile,
  mediaDialogFilters,
  MEDIA_EXTS_REGEX,
  ACCEPTED_MEDIA_LABEL,
} from '../../media/extensions'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TL = require('../../../renderer/store/useTimeline.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PJ = require('../../../renderer/store/useProject.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EX = require('../../../renderer/store/useExport.js')

interface TimelineTestApi {
  clips: unknown[]
  audioTracks: Array<{ id: string; trackIndex: number; startMs: number; name?: string }>
  textClips: Array<{ id: string; trackIndex: number }>
  tracks: Array<{ id: string; index: number; kind: string; name: string; muted: boolean; solo: boolean; locked: boolean; hidden: boolean }>
  clearTimeline: () => void
  loadTimeline: (d: Record<string, unknown>) => void
  deleteTrack: (id: string) => void
  moveAudioTrack: (id: string, ms: number, lane?: number) => void
  moveAudioTrackLive: (id: string, ms: number, lane?: number) => void
  moveTrack: (id: string, dir: 'up' | 'down') => void
  addTrack: (kind: 'video' | 'audio') => void
  setAudioName: (id: string, name: string) => void
  renameTrack: (id: string, name: string) => void
  toggleMuteTrack: (id: string) => void
  toggleSoloTrack: (id: string) => void
  toggleLockTrack: (id: string) => void
  toggleHideTrack: (id: string) => void
}

const { useTimeline, computeEffectiveMuted, performUndo, performRedo } = TL as {
  useTimeline: {
    getState: () => TimelineTestApi
    setState: (p: Record<string, unknown>) => void
  }
  computeEffectiveMuted: (trackMuted: boolean, trackIndex: number, tracks: unknown[]) => boolean
  performUndo: () => boolean
  performRedo: () => boolean
}

const TRANSFORM = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
  cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
}

function resetProject(): void {
  useTimeline.getState().clearTimeline()
  ;(PJ.useProject.getState() as { loadProject: (d: Record<string, unknown>) => void }).loadProject({
    name: 'Tracks Test',
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    aspectRatio: '16:9',
    backgroundColor: '#000000',
    projectFilePath: null,
  })
}

function seedLanes(): void {
  useTimeline.getState().loadTimeline({
    clips: [
      {
        id: 'clip_v0', path: '/media/v0.mp4', startMs: 0, sourceDurationMs: 5000,
        durationMs: 3000, trackIndex: 0, trimStart: 0, trimEnd: 2000, name: 'V0',
        hasAudio: true, transform: { ...TRANSFORM }, speed: 1, volume: 1, muted: false,
      },
      {
        id: 'clip_v1', path: '/media/v1.mp4', startMs: 0, sourceDurationMs: 5000,
        durationMs: 3000, trackIndex: 1, trimStart: 0, trimEnd: 2000, name: 'V1',
        hasAudio: true, transform: { ...TRANSFORM }, speed: 1, volume: 1, muted: false,
      },
    ],
    audioTracks: [
      {
        id: 'audio_a0', path: '/media/a0.mp3', startMs: 0, sourceDurationMs: 5000,
        durationMs: 5000, volume: 1, muted: false, name: 'A0', role: 'music',
        trimStart: 0, trimEnd: 0, trackIndex: 0,
      },
      {
        id: 'audio_a1', path: '/media/a1.mp3', startMs: 1000, sourceDurationMs: 5000,
        durationMs: 5000, volume: 1, muted: false, name: 'A1', role: 'sfx',
        trimStart: 0, trimEnd: 0, trackIndex: 1,
      },
      {
        id: 'audio_a1b', path: '/media/a1b.mp3', startMs: 2000, sourceDurationMs: 5000,
        durationMs: 5000, volume: 1, muted: false, name: 'A1b', role: 'voice',
        trimStart: 0, trimEnd: 0, trackIndex: 1,
      },
    ],
    textClips: [
      {
        id: 'text_c0', startMs: 0, durationMs: 1000, endMs: 1000, trackIndex: 0,
        text: 'cap lane 0', fadeInMs: 0, fadeOutMs: 0,
      },
      {
        id: 'text_c1', startMs: 0, durationMs: 1000, endMs: 1000, trackIndex: 1,
        text: 'cap lane 1', fadeInMs: 0, fadeOutMs: 0,
      },
    ],
    tracks: [
      { id: 'track_video_0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false, solo: false },
      { id: 'track_video_1', index: 1, name: 'Video 2', kind: 'video', muted: false, locked: false, hidden: false, solo: false },
      { id: 'track_audio_0', index: 0, name: 'Audio 1', kind: 'audio', muted: false, locked: false, hidden: false, solo: false },
      { id: 'track_audio_1', index: 1, name: 'Audio 2', kind: 'audio', muted: false, locked: false, hidden: false, solo: false },
      { id: 'track_caption_0', index: 0, name: 'Captions', kind: 'caption', muted: false, locked: false, hidden: false, solo: false },
      { id: 'track_caption_1', index: 1, name: 'Captions 2', kind: 'caption', muted: false, locked: false, hidden: false, solo: false },
    ],
    markers: [],
    playheadMs: 0, zoom: 1, masterVolume: 1, loopEnabled: false,
  })
}

function snapshotJson(): string {
  const s = useTimeline.getState()
  return JSON.stringify({
    clips: s.clips, audioTracks: s.audioTracks, textClips: s.textClips, tracks: s.tracks,
  })
}

describe('phase 1 — track/layer bug fixes + SSOT extractions', () => {
  beforeEach(() => {
    resetProject()
  })

  it('P1.1 deleteTrack on an audio lane removes its clips, leaves other lanes intact, undo restores byte-identical', () => {
    seedLanes()
    const before = snapshotJson()
    const st = useTimeline.getState() as unknown as { deleteTrack: (id: string) => void }

    st.deleteTrack('track_audio_1')

    const after = useTimeline.getState()
    assert.deepEqual(
      (after.audioTracks as Array<{ id: string }>).map((a) => a.id),
      ['audio_a0'],
    )
    // Video + captions untouched.
    assert.equal((after.clips as unknown[]).length, 2)
    assert.equal((after.textClips as unknown[]).length, 2)
    assert.ok(!(after.tracks as Array<{ id: string }>).some((t) => t.id === 'track_audio_1'))

    assert.equal(performUndo(), true)
    assert.equal(snapshotJson(), before)
    assert.equal(performRedo(), true)
    assert.deepEqual(
      (useTimeline.getState().audioTracks as Array<{ id: string }>).map((a) => a.id),
      ['audio_a0'],
    )
    assert.equal(performUndo(), true)
    assert.equal(snapshotJson(), before)
  })

  it('P1.1 deleteTrack cascades video and caption lanes too (overlay drops the record only)', () => {
    seedLanes()
    const st = useTimeline.getState() as unknown as { deleteTrack: (id: string) => void }

    st.deleteTrack('track_video_1')
    assert.deepEqual(
      (useTimeline.getState().clips as Array<{ id: string }>).map((c) => c.id),
      ['clip_v0'],
    )
    assert.equal((useTimeline.getState().audioTracks as unknown[]).length, 3)

    st.deleteTrack('track_caption_1')
    assert.deepEqual(
      (useTimeline.getState().textClips as Array<{ id: string }>).map((c) => c.id),
      ['text_c0'],
    )

    // Unknown id is a no-op (no throw, no state change).
    const before = snapshotJson()
    st.deleteTrack('track_missing')
    assert.equal(snapshotJson(), before)
  })

  it('P1.2 moveAudioTrack lane change updates grouping and computeEffectiveMuted follows the new parent lane', () => {
    seedLanes()
    const st = useTimeline.getState() as unknown as {
      moveAudioTrack: (id: string, ms: number, lane?: number) => void
      toggleMuteTrack: (id: string) => void
    }
    // Mute the lane-1 parent only.
    st.toggleMuteTrack('track_audio_1')

    let tracks = useTimeline.getState().tracks as unknown[]
    assert.equal(computeEffectiveMuted(false, 0, tracks), false)
    assert.equal(computeEffectiveMuted(false, 1, tracks), true)

    const before = snapshotJson()
    st.moveAudioTrack('audio_a0', 500, 1)
    const moved = (useTimeline.getState().audioTracks as Array<{ id: string; trackIndex: number; startMs: number }>)
      .find((a) => a.id === 'audio_a0')
    assert.equal(moved?.trackIndex, 1)
    assert.equal(moved?.startMs, 500)

    tracks = useTimeline.getState().tracks as unknown[]
    assert.equal(computeEffectiveMuted(false, moved?.trackIndex ?? -1, tracks), true)

    // Time-only move preserves the lane (backward compatible).
    st.moveAudioTrack('audio_a0', 700)
    const kept = (useTimeline.getState().audioTracks as Array<{ id: string; trackIndex: number; startMs: number }>)
      .find((a) => a.id === 'audio_a0')
    assert.equal(kept?.trackIndex, 1)
    assert.equal(kept?.startMs, 700)

    assert.equal(performUndo(), true)
    assert.equal(performUndo(), true)
    assert.equal(snapshotJson(), before)
  })

  it('P1.2 drag path (moveAudioTrackLive) mutates without pushing undo', () => {
    seedLanes()
    const st = useTimeline.getState() as unknown as {
      moveAudioTrackLive: (id: string, ms: number, lane?: number) => void
    }
    // loadTimeline resets stacks — live move must not create an entry.
    assert.equal(performUndo(), false)
    st.moveAudioTrackLive('audio_a0', 250, 1)
    const moved = (useTimeline.getState().audioTracks as Array<{ id: string; trackIndex: number }>)
      .find((a) => a.id === 'audio_a0')
    assert.equal(moved?.trackIndex, 1)
    assert.equal(performUndo(), false)
  })

  it('P1.3 moveTrack swaps lanes WITH content; edge moves are no-ops that push no undo', () => {
    seedLanes()
    const st = useTimeline.getState() as unknown as {
      moveTrack: (id: string, dir: 'up' | 'down') => void
    }
    const before = snapshotJson()

    st.moveTrack('track_audio_0', 'down')
    const tracks = useTimeline.getState().tracks as Array<{ id: string; index: number; kind: string }>
    assert.equal(tracks.find((t) => t.id === 'track_audio_0')?.index, 1)
    assert.equal(tracks.find((t) => t.id === 'track_audio_1')?.index, 0)
    // Content followed its lane.
    const lanes = (useTimeline.getState().audioTracks as Array<{ id: string; trackIndex: number }>)
    assert.equal(lanes.find((a) => a.id === 'audio_a0')?.trackIndex, 1)
    assert.equal(lanes.find((a) => a.id === 'audio_a1')?.trackIndex, 0)
    assert.equal(lanes.find((a) => a.id === 'audio_a1b')?.trackIndex, 0)

    assert.equal(performUndo(), true)
    assert.equal(snapshotJson(), before)

    // Edge: top lane 'up' is a no-op and pushes nothing.
    assert.equal(performUndo(), false)
    st.moveTrack('track_audio_0', 'up')
    assert.equal(snapshotJson(), before)
    assert.equal(performUndo(), false)

    // Unknown id is a no-op.
    st.moveTrack('track_missing', 'down')
    assert.equal(snapshotJson(), before)
  })

  it('P1.3/P1.1 addTrack index after deletes never collides', () => {
    seedLanes()
    const st = useTimeline.getState() as unknown as {
      deleteTrack: (id: string) => void
      addTrack: (kind: 'video' | 'audio') => void
    }
    st.deleteTrack('track_video_1')
    st.addTrack('video')
    const indices = (useTimeline.getState().tracks as Array<{ kind: string; index: number }>)
      .filter((t) => t.kind === 'video')
      .map((t) => t.index)
    assert.deepEqual([...indices].sort((a, b) => a - b), [0, 1])
    assert.equal(new Set(indices).size, indices.length)
  })

  it('P1.1/G7 setAudioName renames with undo coverage', () => {
    seedLanes()
    const st = useTimeline.getState() as unknown as {
      setAudioName: (id: string, name: string) => void
    }
    const before = snapshotJson()
    st.setAudioName('audio_a0', 'Dialogue')
    assert.equal(
      (useTimeline.getState().audioTracks as Array<{ id: string; name?: string }>)
        .find((a) => a.id === 'audio_a0')?.name,
      'Dialogue',
    )
    assert.equal(performUndo(), true)
    assert.equal(snapshotJson(), before)
  })

  it('P1 toggles round-trip through save-payload validation', () => {
    seedLanes()
    const st = useTimeline.getState() as unknown as {
      renameTrack: (id: string, name: string) => void
      toggleMuteTrack: (id: string) => void
      toggleSoloTrack: (id: string) => void
      toggleLockTrack: (id: string) => void
      toggleHideTrack: (id: string) => void
    }
    st.renameTrack('track_audio_0', 'Dialogue Bus')
    st.toggleMuteTrack('track_audio_0')
    st.toggleSoloTrack('track_video_1')
    st.toggleLockTrack('track_video_0')
    st.toggleHideTrack('track_video_0')

    const s = useTimeline.getState()
    const payload = {
      version: '1.0',
      name: 'Toggle Project',
      fps: 30,
      resolution: { width: 1920, height: 1080 },
      aspectRatio: '16:9',
      backgroundColor: '#000000',
      clips: (s.clips as Array<Record<string, unknown>>).map((c) => ({ ...c })),
      audioTracks: (s.audioTracks as Array<Record<string, unknown>>).map((a) => ({ ...a })),
      textClips: (s.textClips as Array<Record<string, unknown>>).map((t) => ({ ...t })),
      tracks: (s.tracks as Array<Record<string, unknown>>).map((t) => ({ ...t })),
      markers: [],
      exportPreset: 'youtube',
      captions: {
        entries: (s.textClips as Array<Record<string, unknown>>).map((t) => ({ ...t })),
        style: {
          fontFamily: 'Inter', fontSize: 48, fontWeight: 700, color: '#ffffff',
          strokeColor: '#000000', strokeWidth: 1, bgColor: '#000000', bgOpacity: 0.5,
          alignment: 'center', position: 'bottom', x: 50, y: 75, rotation: 0, scale: 1,
          animation: 'pop', captionMode: 'full-phrase', revealFadeMs: 0,
        },
        language: 'en',
      },
      playheadMs: 0,
      zoom: 1,
      masterVolume: 1,
      loopEnabled: false,
      exportConfig: {
        preset: 'youtube', customWidth: 1920, customHeight: 1080,
        upscaleEnabled: false, upscaleAlgorithm: 'lanczos',
        codec: 'h264', qualityPreset: 'slow',
        bitrateKbps: 8000, bitrateMode: 'cbr',
        exportFrameRange: null, audioOnly: false, fps: 30, hardwareAccel: false,
      },
    }
    const result = validateProjectFile(payload)
    assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors))
  })

  it('P1.4 extension SSOT resolves identical sets incl. m4a; story-39 names classify', () => {
    // One list, three consumers: dialog filters equal the SSOT set.
    const [media, all] = mediaDialogFilters()
    assert.deepEqual([...media.extensions].sort(), [...MEDIA_EXTENSIONS].sort())
    assert.deepEqual(all, { name: 'All Files', extensions: ['*'] })
    assert.ok((MEDIA_EXTENSIONS as readonly string[]).includes('m4a'))
    // Regex mirrors match the pure helpers on every extension.
    for (const ext of MEDIA_EXTENSIONS) {
      assert.equal(MEDIA_EXTS_REGEX.test(`file.${ext}`), true, ext)
      assert.equal(isSupportedMedia(`file.${ext}`), true, ext)
      assert.equal(isSupportedMedia(`FILE.${ext.toUpperCase()}`), true, ext)
    }
    assert.ok(ACCEPTED_MEDIA_LABEL.includes('m4a'))
    // Audio/video partition covers the whole set with no overlap.
    assert.deepEqual(
      [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS].sort(),
      [...MEDIA_EXTENSIONS].sort(),
    )
    for (const ext of AUDIO_EXTENSIONS) {
      assert.equal(isAudioFile(`clip.${ext}`), true)
      assert.equal(isVideoFile(`clip.${ext}`), false)
    }
    // Story-39 gauntlet (names only — files never touched).
    assert.equal(isSupportedMedia('vid/1.mp4'), true)
    assert.equal(isVideoFile('vid/3.mp4'), true)
    assert.equal(isSupportedMedia('crunchy.mp3'), true)
    assert.equal(isAudioFile('smoky.mp3'), true)
    assert.equal(isSupportedMedia("I made an air fryer in ancient China. It didn't go well.mp4"), true)
    assert.equal(isAudioFile("I made an air fryer in ancient China. It didn't go well.mp3"), true)
    assert.equal(isSupportedMedia("I made an air fryer in ancient China. It didn't go well.srt"), false)
    assert.equal(isSupportedMedia('movie.m4a'), true)
    assert.equal(isAudioFile('movie.m4a'), true)
    assert.equal(isSupportedMedia('still.png'), false)
  })

  it('P1.6 clearQueue keeps running/pending and clears finished history', () => {
    const ex = EX.useExport.getState() as {
      clearQueue: () => void
    }
    EX.useExport.setState({
      queue: [
        { id: 'j-run', status: 'running', progress: 10, outputPath: '/tmp/a.mp4', createdAt: 1 },
        { id: 'j-pend', status: 'pending', progress: 0, outputPath: '/tmp/b.mp4', createdAt: 2 },
        { id: 'j-done', status: 'completed', progress: 100, outputPath: '/tmp/c.mp4', createdAt: 3 },
        { id: 'j-cancel', status: 'cancelled', progress: 40, outputPath: '/tmp/d.mp4', createdAt: 4 },
        { id: 'j-err', status: 'error', progress: 60, outputPath: '/tmp/e.mp4', createdAt: 5, error: 'boom' },
      ],
    })
    ex.clearQueue()
    assert.deepEqual(
      (EX.useExport.getState().queue as Array<{ id: string }>).map((j) => j.id).sort(),
      ['j-pend', 'j-run'],
    )
    EX.useExport.getState().resetExportSession()
    assert.equal((EX.useExport.getState().queue as unknown[]).length, 0)
  })
})
