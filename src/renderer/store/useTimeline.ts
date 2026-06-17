import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { useProject } from './useProject'
import { clearWaveformCache } from '../services/WaveformService'
import type { CaptionStyle } from './useCaption'

function uuid(): string {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Capture current timeline + caption state for undo */
export function pushUndoSnapshot(): void {
  const { clips, audioTracks, textClips } = useTimeline.getState()
  useProject.getState().pushUndo({
    clips: clips.map((c) => ({ ...c })),
    audioTracks: audioTracks.map((a) => ({ ...a })),
    textClips: textClips.map((tc) => ({ ...tc })),
    captions: textClips.map((tc) => ({
      id: tc.id, startMs: tc.startMs, endMs: tc.endMs, text: tc.text
    }))
  })
}

// ---------------------------------------------------------------------------
// Deferred undo — captures pre-interaction state for drag/trim operations
// ---------------------------------------------------------------------------

let _dragPreClips: Clip[] | null = null
let _dragPreAudioTracks: AudioTrack[] | null = null
let _dragPreTextClips: TextClip[] | null = null

// ---------------------------------------------------------------------------
// Clipboard — module-level (ephemeral, not persisted in undo stack)
// ---------------------------------------------------------------------------

interface ClipboardData {
  clips: Clip[]
  audioTracks: AudioTrack[]
  textClips: TextClip[]
}

let _clipboard: ClipboardData | null = null

export function getClipboard(): ClipboardData | null { return _clipboard }

// ---------------------------------------------------------------------------
// In/Out points — module-level ephemeral editing state
// ---------------------------------------------------------------------------

let _inPointMs: number | null = null
let _outPointMs: number | null = null

export function getInPoint(): number | null { return _inPointMs }
export function getOutPoint(): number | null { return _outPointMs }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClipTransform {
  x: number        // px offset from canvas center
  y: number
  scaleX: number   // 1.0 = native size
  scaleY: number
  rotation: number // degrees
  opacity: number  // 0-1
  cropTop: number; cropBottom: number; cropLeft: number; cropRight: number // 0-1 fractions
}

export const DEFAULT_TRANSFORM: ClipTransform = {
  x: 0, y: 0, scaleX: 1, scaleY: 1,
  rotation: 0, opacity: 1,
  cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0
}

export interface Track {
  id: string
  index: number
  name: string
  kind: 'video' | 'audio' | 'caption' | 'overlay'
  muted: boolean
  locked: boolean
  hidden: boolean
}

export interface TimelineMarker {
  id: string
  timeMs: number
  label: string
  color: string
}

export interface Clip {
  id: string
  path: string
  startMs: number
  sourceDurationMs: number
  durationMs: number
  trackIndex: number
  trimStart: number
  trimEnd: number
  name?: string
  transform?: ClipTransform
  speed: number  // playback speed multiplier (0.25 – 4.0, default 1.0)
}

export interface AudioTrack {
  id: string
  path: string
  startMs: number
  durationMs: number
  volume: number
  muted: boolean
  name?: string
  /** Role classification for transcription filtering */
  role: 'voice' | 'music' | 'sfx' | 'ambient'
}

export interface TextClip {
  id: string
  startMs: number
  durationMs: number
  endMs: number
  trackIndex: number
  text: string
  style?: CaptionStyle
  words?: Array<{ word: string; startMs: number; endMs: number }>
  /** 'whisper' = from token-level JSON timestamps, 'synthetic' = character-count estimate */
  wordTimestampsSource?: 'whisper' | 'synthetic'

  // ---- Ownership metadata ----
  /** Unique ID of the source that generated this caption (clip id, track id, 'timeline', or undefined for imports) */
  sourceId?: string
  /** What kind of source produced this caption */
  sourceType?: 'clip' | 'audioTrack' | 'timeline' | 'import'
  /** Job identifier for re-transcription and lifecycle binding */
  transcriptionJobId?: string
}

// ---------------------------------------------------------------------------
// State / Actions
// ---------------------------------------------------------------------------

interface TimelineState {
  clips: Clip[]
  audioTracks: AudioTrack[]
  textClips: TextClip[]
  tracks: Track[]
  markers: TimelineMarker[]
  playheadMs: number
  totalDurationMs: number
  zoom: number
  selectedClipId: string | null
  selectedTextClipId: string | null
  /** Multi-select: all selected video clip IDs (includes focused) */
  selectedClipIds: string[]
  /** Multi-select: all selected text clip IDs (includes focused) */
  selectedTextClipIds: string[]
  isPlaying: boolean
  masterVolume: number
}

interface TimelineActions {
  addClip: (clip: Clip) => void
  moveClip: (clipId: string, startMs: number, trackIndex?: number) => void
  trimClip: (clipId: string, trimStart: number, trimEnd: number) => void
  deleteClip: (clipId: string) => void
  duplicateClip: (clipId: string) => void
  splitClipAtPlayhead: () => void
  setClipTransform: (clipId: string, transform: Partial<ClipTransform>) => void
  setClipSpeed: (clipId: string, speed: number) => void

  addAudioTrack: (track: AudioTrack) => void
  removeAudioTrack: (trackId: string) => void
  moveAudioTrack: (trackId: string, startMs: number) => void
  setAudioVolume: (trackId: string, volume: number) => void
  toggleAudioMute: (trackId: string) => void

  addTextClip: (clip: TextClip) => void
  /** Batch-insert text clips in a single atomic operation (1 undo snapshot, 1 Zustand commit).
   *  Use this for transcription results to avoid O(n) mutation storms. */
  addTextClips: (clips: TextClip[]) => void
  updateTextClip: (id: string, updates: Partial<TextClip>) => void
  deleteTextClip: (id: string) => void
  selectTextClip: (id: string | null) => void
  splitTextClip: (id: string, splitAtMs: number) => void

  /** Deferred undo: capture pre-interaction state (call on mousedown before any mutation) */
  beginDragCapture: () => void
  /** Deferred undo: push the captured pre-interaction snapshot (call on mouseup) */
  commitDrag: () => void
  /** Deferred undo: revert to pre-interaction state and discard (call on Escape/blur — no undo entry) */
  cancelDrag: () => void
  /** Live update — no undo snapshot (for use during drag/trim interactions) */
  moveClipLive: (clipId: string, startMs: number, trackIndex?: number) => void
  /** Live update — no undo snapshot */
  trimClipLive: (clipId: string, trimStart: number, trimEnd: number) => void
  /** Live update — no undo snapshot */
  updateTextClipLive: (id: string, updates: Partial<TextClip>) => void

  addTrack: (kind: Track['kind']) => void
  deleteTrack: (trackId: string) => void
  renameTrack: (trackId: string, name: string) => void
  toggleMuteTrack: (trackId: string) => void
  toggleLockTrack: (trackId: string) => void
  toggleHideTrack: (trackId: string) => void

  addMarker: (marker: Omit<TimelineMarker, 'id'>) => void
  removeMarker: (markerId: string) => void
  clearMarkers: () => void

  setPlayhead: (ms: number) => void
  setZoom: (zoom: number) => void
  selectClip: (clipId: string | null) => void
  /** Toggle a clip in/out of multi-selection (Ctrl+click) */
  toggleClipSelection: (clipId: string) => void
  /** Select clips from last selected to target (Shift+click) */
  selectClipRange: (clipId: string) => void
  /** Select all clips and text clips */
  selectAll: () => void
  /** Clear all selections */
  deselectAll: () => void
  /** Toggle a text clip in/out of multi-selection */
  toggleTextClipSelection: (id: string) => void
  /** Delete all currently selected clips + text clips */
  deleteSelected: () => void
  /** Duplicate all currently selected clips */
  duplicateSelected: () => void
  /** Move all selected clips by delta (live, no undo) */
  moveSelectedClipsLive: (deltaMs: number, deltaTrack?: number) => void
  /** Copy selection to clipboard */
  copySelection: () => void
  /** Cut selection to clipboard (copy + delete) */
  cutSelection: () => void
  /** Paste clipboard at playhead */
  pasteAtPlayhead: () => void
  /** Set in-point marker */
  setInPoint: (ms: number) => void
  /** Set out-point marker */
  setOutPoint: (ms: number) => void
  /** Clear in/out points */
  clearInOut: () => void
  /** Delete clip with ripple (close gap) */
  rippleDeleteClip: (clipId: string) => void
  /** Set master volume (0-1) */
  setMasterVolume: (volume: number) => void
  setPlaying: (playing: boolean) => void
  clearTimeline: () => void
  loadTimeline: (data: { clips: Clip[]; audioTracks: AudioTrack[]; textClips?: TextClip[] }) => void
  recalcTotalDuration: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recalcDuration(clips: Clip[]): number {
  if (clips.length === 0) return 0
  return clips.reduce((max, c) => Math.max(max, c.startMs + c.durationMs), 0)
}

function makeDefaultTracks(): Track[] {
  return [
    { id: 'track_v0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false }
  ]
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialState: TimelineState = {
  clips: [],
  audioTracks: [],
  textClips: [],
  tracks: makeDefaultTracks(),
  markers: [],
  playheadMs: 0,
  totalDurationMs: 0,
  zoom: 1,
  selectedClipId: null,
  selectedTextClipId: null,
  selectedClipIds: [],
  selectedTextClipIds: [],
  isPlaying: false,
  masterVolume: 0.8
}

export const useTimeline = create<TimelineState & TimelineActions>()(
  immer((set) => ({
    ...initialState,

    addClip: (clip) => {
      pushUndoSnapshot()
      set((state) => {
        if (!clip.sourceDurationMs) clip.sourceDurationMs = clip.durationMs
        if (!clip.transform) clip.transform = { ...DEFAULT_TRANSFORM }
        if (!clip.speed) clip.speed = 1.0
        state.clips.push(clip)
        state.totalDurationMs = recalcDuration(state.clips)
        // Auto-create a Track entry if this trackIndex doesn't have one yet
        const exists = state.tracks.some((t) => t.kind === 'video' && t.index === clip.trackIndex)
        if (!exists) {
          state.tracks.push({
            id: `track_v${clip.trackIndex}`,
            index: clip.trackIndex,
            name: `Video ${clip.trackIndex + 1}`,
            kind: 'video',
            muted: false,
            locked: false,
            hidden: false
          })
        }
      })
    },

    moveClip: (clipId, startMs, trackIndex) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.startMs = Math.max(0, startMs)
          if (trackIndex !== undefined) clip.trackIndex = trackIndex
          state.totalDurationMs = recalcDuration(state.clips)
        }
      })
    },

    trimClip: (clipId, trimStart, trimEnd) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.trimStart = trimStart
          clip.trimEnd = trimEnd
          clip.durationMs = clip.sourceDurationMs - trimStart - trimEnd
        }
      })
    },

    moveClipLive: (clipId, startMs, trackIndex) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.startMs = Math.max(0, startMs)
          if (trackIndex !== undefined) clip.trackIndex = trackIndex
          state.totalDurationMs = recalcDuration(state.clips)
        }
      })
    },

    trimClipLive: (clipId, trimStart, trimEnd) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.trimStart = trimStart
          clip.trimEnd = trimEnd
          clip.durationMs = clip.sourceDurationMs - trimStart - trimEnd
        }
      })
    },

    deleteClip: (clipId) => {
      pushUndoSnapshot()
      set((state) => {
        state.clips = state.clips.filter((c) => c.id !== clipId)
        if (state.selectedClipId === clipId) state.selectedClipId = null
        state.selectedClipIds = state.selectedClipIds.filter((id) => id !== clipId)
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    deleteSelected: () => {
      const { selectedClipIds, selectedTextClipIds } = useTimeline.getState()
      if (selectedClipIds.length === 0 && selectedTextClipIds.length === 0) return
      pushUndoSnapshot()
      set((state) => {
        const clipSet = new Set(state.selectedClipIds)
        const textSet = new Set(state.selectedTextClipIds)
        state.clips = state.clips.filter((c) => !clipSet.has(c.id))
        state.textClips = state.textClips.filter((tc) => !textSet.has(tc.id))
        state.selectedClipId = null
        state.selectedTextClipId = null
        state.selectedClipIds = []
        state.selectedTextClipIds = []
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    duplicateClip: (clipId) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (!clip) return
        const newClip: Clip = {
          ...clip,
          id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          startMs: clip.startMs + clip.durationMs + 100,
          transform: clip.transform ? { ...clip.transform } : { ...DEFAULT_TRANSFORM },
          name: clip.name ? `${clip.name} (copy)` : 'Clip (copy)'
        }
        state.clips.push(newClip)
        state.totalDurationMs = recalcDuration(state.clips)
        state.selectedClipId = newClip.id
        state.selectedClipIds = [newClip.id]
      })
    },

    duplicateSelected: () => {
      const { selectedClipIds } = useTimeline.getState()
      if (selectedClipIds.length === 0) return
      pushUndoSnapshot()
      set((state) => {
        const newIds: string[] = []
        for (const id of state.selectedClipIds) {
          const clip = state.clips.find((c) => c.id === id)
          if (!clip) continue
          const newClip: Clip = {
            ...clip,
            id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            startMs: clip.startMs + clip.durationMs + 100,
            transform: clip.transform ? { ...clip.transform } : { ...DEFAULT_TRANSFORM },
            name: clip.name ? `${clip.name} (copy)` : 'Clip (copy)'
          }
          state.clips.push(newClip)
          newIds.push(newClip.id)
        }
        state.totalDurationMs = recalcDuration(state.clips)
        state.selectedClipIds = newIds
        state.selectedClipId = newIds.length > 0 ? newIds[0] : null
      })
    },

    moveSelectedClipsLive: (deltaMs, deltaTrack) => {
      set((state) => {
        const clipSet = new Set(state.selectedClipIds)
        for (const clip of state.clips) {
          if (clipSet.has(clip.id)) {
            clip.startMs = Math.max(0, clip.startMs + deltaMs)
            if (deltaTrack !== undefined) {
              clip.trackIndex = Math.max(0, clip.trackIndex + deltaTrack)
            }
          }
        }
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    copySelection: () => {
      const { clips, textClips, selectedClipIds, selectedTextClipIds } = useTimeline.getState()
      const clipSet = new Set(selectedClipIds)
      const textSet = new Set(selectedTextClipIds)
      _clipboard = {
        clips: clips.filter((c) => clipSet.has(c.id)).map((c) => ({ ...c })),
        audioTracks: [],
        textClips: textClips.filter((tc) => textSet.has(tc.id)).map((tc) => ({ ...tc }))
      }
    },

    cutSelection: () => {
      useTimeline.getState().copySelection()
      useTimeline.getState().deleteSelected()
    },

    pasteAtPlayhead: () => {
      if (!_clipboard) return
      pushUndoSnapshot()
      const { playheadMs } = useTimeline.getState()
      set((state) => {
        const newClipIds: string[] = []
        if (_clipboard!.clips.length > 0) {
          const minStart = Math.min(..._clipboard!.clips.map((c) => c.startMs))
          const offset = playheadMs - minStart
          for (const orig of _clipboard!.clips) {
            const newId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            state.clips.push({
              ...orig,
              id: newId,
              startMs: orig.startMs + offset,
              transform: orig.transform ? { ...orig.transform } : { ...DEFAULT_TRANSFORM }
            })
            newClipIds.push(newId)
          }
        }
        if (_clipboard!.textClips.length > 0) {
          const minStart = Math.min(..._clipboard!.textClips.map((tc) => tc.startMs))
          const offset = playheadMs - minStart
          for (const orig of _clipboard!.textClips) {
            const newId = `text_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            state.textClips.push({
              ...orig,
              id: newId,
              startMs: orig.startMs + offset,
              endMs: orig.startMs + offset + orig.durationMs,
              style: orig.style ? { ...orig.style } : undefined,
              words: orig.words ? orig.words.map((w) => ({ ...w })) : undefined
            })
          }
        }
        state.selectedClipIds = newClipIds
        state.selectedClipId = newClipIds.length > 0 ? newClipIds[0] : null
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    setInPoint: (ms) => { _inPointMs = ms },
    setOutPoint: (ms) => { _outPointMs = ms },
    clearInOut: () => { _inPointMs = null; _outPointMs = null },

    setMasterVolume: (volume) =>
      set((state) => {
        state.masterVolume = Math.max(0, Math.min(1, volume))
      }),

    rippleDeleteClip: (clipId) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (!clip) return
        const clipEnd = clip.startMs + clip.durationMs
        state.clips = state.clips.filter((c) => c.id !== clipId)
        for (const c of state.clips) {
          if (c.startMs >= clipEnd) {
            c.startMs -= clip.durationMs
          }
        }
        for (const tc of state.textClips) {
          if (tc.startMs >= clipEnd) {
            const shift = clip.durationMs
            tc.startMs -= shift
            tc.endMs -= shift
          }
        }
        for (const a of state.audioTracks) {
          if (a.startMs >= clipEnd) {
            a.startMs -= clip.durationMs
          }
        }
        if (state.selectedClipId === clipId) state.selectedClipId = null
        state.selectedClipIds = state.selectedClipIds.filter((id) => id !== clipId)
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    splitClipAtPlayhead: () => {
      // ---- Context-aware: text clip split takes priority ----
      // When a caption/text clip is selected, 'S' must split that, not a video clip.
      const { selectedTextClipId, playheadMs: ph } = useTimeline.getState()
      if (selectedTextClipId) {
        const textClip = useTimeline.getState().textClips.find(
          (tc) => tc.id === selectedTextClipId &&
          ph > tc.startMs &&
          ph < tc.endMs
        )
        if (textClip) {
          useTimeline.getState().splitTextClip(selectedTextClipId, ph)
          return
        }
        // Text clip selected but playhead not inside it — no-op (don't fall through to video)
        return
      }

      // ---- Video clip split ----
      pushUndoSnapshot()
      set((state) => {
        const { playheadMs, selectedClipId } = state

        // Prefer the selected clip if playhead is within it
        let clipIndex = -1
        if (selectedClipId) {
          const selIdx = state.clips.findIndex(
            (c) => c.id === selectedClipId &&
            playheadMs >= c.startMs &&
            playheadMs < c.startMs + c.durationMs
          )
          if (selIdx >= 0) clipIndex = selIdx
        }

        // Fall back: any clip under the playhead
        if (clipIndex < 0) {
          clipIndex = state.clips.findIndex(
            (c) => playheadMs >= c.startMs && playheadMs < c.startMs + c.durationMs
          )
        }

        if (clipIndex < 0) return // playhead not over any clip — no-op

        const clip = state.clips[clipIndex]
        const splitPoint = playheadMs - clip.startMs
        const remainingDuration = clip.durationMs - splitPoint

        clip.durationMs = splitPoint

        const newClip: Clip = {
          id: `${clip.id}_split_${Date.now()}`,
          path: clip.path,
          startMs: playheadMs,
          sourceDurationMs: clip.sourceDurationMs,
          durationMs: remainingDuration,
          trackIndex: clip.trackIndex,
          trimStart: clip.trimStart + splitPoint,
          trimEnd: clip.trimEnd,
          name: clip.name,
          transform: clip.transform ? { ...clip.transform } : { ...DEFAULT_TRANSFORM },
          speed: clip.speed
        }

        state.clips.splice(clipIndex + 1, 0, newClip)
      })
    },

    setClipTransform: (clipId, transform) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          if (!clip.transform) clip.transform = { ...DEFAULT_TRANSFORM }
          Object.assign(clip.transform, transform)
        }
      })
    },

    setClipSpeed: (clipId, speed) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.speed = Math.max(0.25, Math.min(4.0, speed))
        }
      })
    },

    addAudioTrack: (track) => {
      pushUndoSnapshot()
      set((state) => {
        state.audioTracks.push(track)
      })
    },

    removeAudioTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        state.audioTracks = state.audioTracks.filter((t) => t.id !== trackId)
      })
    },

    moveAudioTrack: (trackId, startMs) =>
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) track.startMs = Math.max(0, startMs)
      }),

    setAudioVolume: (trackId, volume) =>
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) track.volume = Math.max(0, Math.min(1, volume))
      }),

    toggleAudioMute: (trackId) =>
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) track.muted = !track.muted
      }),

    // -- Text Clip management --

    addTextClip: (clip) => {
      pushUndoSnapshot()
      set((state) => {
        state.textClips.push(clip)
        // Auto-create caption track if none exists
        const hasCaptionTrack = state.tracks.some((t) => t.kind === 'caption')
        if (!hasCaptionTrack) {
          state.tracks.push({
            id: `track_caption_0`,
            index: 0,
            name: 'Captions',
            kind: 'caption',
            muted: false,
            locked: false,
            hidden: false
          })
        }
      })
    },

    addTextClips: (clips) => {
      if (clips.length === 0) return
      pushUndoSnapshot()
      set((state) => {
        for (const clip of clips) {
          state.textClips.push(clip)
        }
        // Auto-create caption track if none exists
        const hasCaptionTrack = state.tracks.some((t) => t.kind === 'caption')
        if (!hasCaptionTrack) {
          state.tracks.push({
            id: `track_caption_0`,
            index: 0,
            name: 'Captions',
            kind: 'caption',
            muted: false,
            locked: false,
            hidden: false
          })
        }
      })
    },

    updateTextClip: (id, updates) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.textClips.find((c) => c.id === id)
        if (clip) {
          const oldStartMs = clip.startMs
          const oldDuration = clip.durationMs
          Object.assign(clip, updates)
          if (updates.startMs !== undefined || updates.durationMs !== undefined) {
            clip.endMs = clip.startMs + clip.durationMs
          }
          // When duration shrinks (not a move), clip words to new bounds
          if (clip.words && updates.durationMs !== undefined && updates.durationMs < oldDuration) {
            const startShift = clip.startMs - oldStartMs
            if (startShift > 0) {
              // Left trim: remove words before trimmed region, shift remaining left
              clip.words = clip.words
                .filter((w) => w.endMs > startShift)
                .map((w) => ({ ...w, startMs: w.startMs - startShift, endMs: w.endMs - startShift }))
            }
            // Right trim (or combined): remove words past new duration
            clip.words = clip.words.filter((w) => w.startMs < clip.durationMs)
            if (clip.words.length > 0) {
              const last = clip.words[clip.words.length - 1]
              if (last.endMs > clip.durationMs) last.endMs = clip.durationMs
            }
          }
        }
      })
    },

    updateTextClipLive: (id, updates) => {
      set((state) => {
        const clip = state.textClips.find((c) => c.id === id)
        if (clip) {
          const oldStartMs = clip.startMs
          const oldDuration = clip.durationMs
          Object.assign(clip, updates)
          if (updates.startMs !== undefined || updates.durationMs !== undefined) {
            clip.endMs = clip.startMs + clip.durationMs
          }
          // When duration shrinks (not a move), clip words to new bounds
          if (clip.words && updates.durationMs !== undefined && updates.durationMs < oldDuration) {
            const startShift = clip.startMs - oldStartMs
            if (startShift > 0) {
              // Left trim: remove words before trimmed region, shift remaining left
              clip.words = clip.words
                .filter((w) => w.endMs > startShift)
                .map((w) => ({ ...w, startMs: w.startMs - startShift, endMs: w.endMs - startShift }))
            }
            // Right trim (or combined): remove words past new duration
            clip.words = clip.words.filter((w) => w.startMs < clip.durationMs)
            if (clip.words.length > 0) {
              const last = clip.words[clip.words.length - 1]
              if (last.endMs > clip.durationMs) last.endMs = clip.durationMs
            }
          }
        }
      })
    },

    deleteTextClip: (id) => {
      pushUndoSnapshot()
      set((state) => {
        state.textClips = state.textClips.filter((c) => c.id !== id)
        if (state.selectedTextClipId === id) state.selectedTextClipId = null
        state.selectedTextClipIds = state.selectedTextClipIds.filter((tid) => tid !== id)
      })
    },

    selectTextClip: (id) => {
      set((state) => {
        state.selectedTextClipId = id
        state.selectedClipId = null
        state.selectedTextClipIds = id ? [id] : []
        state.selectedClipIds = []
      })
    },

    beginDragCapture: () => {
      const { clips, audioTracks, textClips } = useTimeline.getState()
      _dragPreClips = clips.map((c) => ({ ...c }))
      _dragPreAudioTracks = audioTracks.map((a) => ({ ...a }))
      _dragPreTextClips = textClips.map((tc) => ({ ...tc }))
    },

    commitDrag: () => {
      if (!_dragPreClips) return
      useProject.getState().pushUndo({
        clips: _dragPreClips,
        audioTracks: _dragPreAudioTracks!,
        textClips: _dragPreTextClips!,
        captions: _dragPreTextClips!.map((tc) => ({
          id: tc.id, startMs: tc.startMs, endMs: tc.endMs, text: tc.text
        }))
      })
      _dragPreClips = null
      _dragPreAudioTracks = null
      _dragPreTextClips = null
    },

    cancelDrag: () => {
      if (!_dragPreClips) return
      const preClips = _dragPreClips
      const preAudio = _dragPreAudioTracks!
      const preText = _dragPreTextClips!
      _dragPreClips = null
      _dragPreAudioTracks = null
      _dragPreTextClips = null
      set((state) => {
        state.clips.length = 0
        state.clips.push(...preClips)
        state.audioTracks.length = 0
        state.audioTracks.push(...preAudio)
        state.textClips.length = 0
        state.textClips.push(...preText)
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    splitTextClip: (id, splitAtMs) => {
      pushUndoSnapshot()
      set((state) => {
        const idx = state.textClips.findIndex((c) => c.id === id)
        if (idx < 0) return
        const clip = state.textClips[idx]

        // Word timestamps are clip-relative (0-based from clip.startMs).
        // Convert absolute split point to clip-relative for comparison.
        const relativeSplit = splitAtMs - clip.startMs

        let firstWords = clip.words
        let secondWords = clip.words
        if (clip.words && clip.words.length > 0) {
          firstWords = clip.words.filter((w) => w.endMs <= relativeSplit)
          secondWords = clip.words
            .filter((w) => w.endMs > relativeSplit)
            .map((w) => ({
              ...w,
              // Normalize to be relative to the second clip's startMs
              startMs: w.startMs - relativeSplit,
              endMs: w.endMs - relativeSplit
            }))
        }

        // Redistribute text to match redistributed words
        const firstText = firstWords && firstWords.length > 0
          ? firstWords.map((w) => w.word).join(' ')
          : clip.text
        const secondText = secondWords && secondWords.length > 0
          ? secondWords.map((w) => w.word).join(' ')
          : clip.text

        const first: TextClip = {
          id: `${clip.id}_a`,
          startMs: clip.startMs,
          durationMs: splitAtMs - clip.startMs,
          endMs: splitAtMs,
          trackIndex: clip.trackIndex,
          text: firstText,
          style: clip.style ? { ...clip.style } : undefined,
          words: firstWords,
          wordTimestampsSource: clip.wordTimestampsSource,
          sourceId: clip.sourceId,
          sourceType: clip.sourceType,
          transcriptionJobId: clip.transcriptionJobId
        }
        const second: TextClip = {
          id: `${clip.id}_b`,
          startMs: splitAtMs,
          durationMs: clip.endMs - splitAtMs,
          endMs: clip.endMs,
          trackIndex: clip.trackIndex,
          text: secondText,
          style: clip.style ? { ...clip.style } : undefined,
          words: secondWords,
          wordTimestampsSource: clip.wordTimestampsSource,
          sourceId: clip.sourceId,
          sourceType: clip.sourceType,
          transcriptionJobId: clip.transcriptionJobId
        }
        state.textClips.splice(idx, 1, first, second)
      })
    },

    // -- Track management --

    addTrack: (kind) =>
      set((state) => {
        const existingOfKind = state.tracks.filter((t) => t.kind === kind)
        const maxIndex = existingOfKind.reduce((m, t) => Math.max(m, t.index), -1)
        const newIndex = maxIndex + 1
        const label = kind.charAt(0).toUpperCase() + kind.slice(1)
        state.tracks.push({
          id: `track_${kind}_${uuid().slice(0, 8)}`,
          index: newIndex,
          name: `${label} ${newIndex + 1}`,
          kind,
          muted: false,
          locked: false,
          hidden: false
        })
      }),

    deleteTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (!track) return
        // Remove all clips on this track index
        state.clips = state.clips.filter((c) => !(c.trackIndex === track.index))
        state.tracks = state.tracks.filter((t) => t.id !== trackId)
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    renameTrack: (trackId, name) =>
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) track.name = name
      }),

    toggleMuteTrack: (trackId) =>
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) track.muted = !track.muted
      }),

    toggleLockTrack: (trackId) =>
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) track.locked = !track.locked
      }),

    toggleHideTrack: (trackId) =>
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) track.hidden = !track.hidden
      }),

    // -- Markers --

    addMarker: (marker) =>
      set((state) => {
        state.markers.push({ ...marker, id: `marker_${Date.now()}` })
      }),

    removeMarker: (markerId) =>
      set((state) => {
        state.markers = state.markers.filter((m) => m.id !== markerId)
      }),

    clearMarkers: () =>
      set((state) => {
        state.markers = []
      }),

    // -- Playback --

    setPlayhead: (ms) =>
      set((state) => {
        state.playheadMs = Math.max(0, ms)
      }),

    setZoom: (zoom) =>
      set((state) => {
        state.zoom = Math.max(0.1, Math.min(10, zoom))
      }),

    selectClip: (clipId) =>
      set((state) => {
        state.selectedClipId = clipId
        state.selectedTextClipId = null
        state.selectedClipIds = clipId ? [clipId] : []
        state.selectedTextClipIds = []
      }),

    toggleClipSelection: (clipId) =>
      set((state) => {
        const idx = state.selectedClipIds.indexOf(clipId)
        if (idx >= 0) {
          state.selectedClipIds.splice(idx, 1)
          if (state.selectedClipId === clipId) {
            state.selectedClipId = state.selectedClipIds.length > 0
              ? state.selectedClipIds[state.selectedClipIds.length - 1]
              : null
          }
        } else {
          state.selectedClipIds.push(clipId)
          state.selectedClipId = clipId
        }
        state.selectedTextClipId = null
        state.selectedTextClipIds = []
      }),

    selectClipRange: (clipId) =>
      set((state) => {
        const sorted = [...state.clips].sort((a, b) => a.startMs - b.startMs)
        const anchorId = state.selectedClipIds.length > 0
          ? state.selectedClipIds[state.selectedClipIds.length - 1]
          : state.selectedClipId
        const anchorIdx = anchorId ? sorted.findIndex((c) => c.id === anchorId) : -1
        const targetIdx = sorted.findIndex((c) => c.id === clipId)
        if (anchorIdx >= 0 && targetIdx >= 0) {
          const lo = Math.min(anchorIdx, targetIdx)
          const hi = Math.max(anchorIdx, targetIdx)
          for (let i = lo; i <= hi; i++) {
            if (!state.selectedClipIds.includes(sorted[i].id)) {
              state.selectedClipIds.push(sorted[i].id)
            }
          }
        } else if (targetIdx >= 0) {
          if (!state.selectedClipIds.includes(clipId)) {
            state.selectedClipIds.push(clipId)
          }
        }
        state.selectedClipId = clipId
        state.selectedTextClipId = null
        state.selectedTextClipIds = []
      }),

    selectAll: () =>
      set((state) => {
        state.selectedClipIds = state.clips.map((c) => c.id)
        state.selectedTextClipIds = state.textClips.map((tc) => tc.id)
        state.selectedClipId = state.clips.length > 0 ? state.clips[0].id : null
        state.selectedTextClipId = null
      }),

    deselectAll: () =>
      set((state) => {
        state.selectedClipId = null
        state.selectedTextClipId = null
        state.selectedClipIds = []
        state.selectedTextClipIds = []
      }),

    toggleTextClipSelection: (id) =>
      set((state) => {
        const idx = state.selectedTextClipIds.indexOf(id)
        if (idx >= 0) {
          state.selectedTextClipIds.splice(idx, 1)
          if (state.selectedTextClipId === id) {
            state.selectedTextClipId = state.selectedTextClipIds.length > 0
              ? state.selectedTextClipIds[state.selectedTextClipIds.length - 1]
              : null
          }
        } else {
          state.selectedTextClipIds.push(id)
          state.selectedTextClipId = id
        }
        state.selectedClipId = null
        state.selectedClipIds = []
      }),

    setPlaying: (playing) =>
      set((state) => {
        state.isPlaying = playing
      }),

    clearTimeline: () => {
      _clipboard = null
      _inPointMs = null
      _outPointMs = null
      clearWaveformCache()
      set(() => ({
        ...initialState,
        tracks: makeDefaultTracks()
      }))
    },

    loadTimeline: (data) =>
      set((state) => {
        state.clips = data.clips || []
        state.audioTracks = data.audioTracks || []
        state.textClips = data.textClips || []
        state.totalDurationMs = recalcDuration(state.clips)
      }),

    recalcTotalDuration: () =>
      set((state) => {
        state.totalDurationMs = recalcDuration(state.clips)
      })
  }))
)
