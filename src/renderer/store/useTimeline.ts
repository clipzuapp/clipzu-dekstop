import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { useProject } from './useProject'
import { clearWaveformCache } from '../services/WaveformService'
import { useCaption, type CaptionStyle } from './useCaption'

function uuid(): string {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ---------------------------------------------------------------------------
// Deep clone helpers (Phase 9: undo correctness)
// ---------------------------------------------------------------------------

function deepCloneTransform(t?: ClipTransform): ClipTransform | undefined {
  return t ? { ...t } : undefined
}

function deepCloneWords(w?: TextClip['words']): TextClip['words'] {
  return w ? w.map((wd) => ({ ...wd })) : undefined
}

function deepCloneClip(c: Clip): Clip {
  return { ...c, transform: deepCloneTransform(c.transform), volume: c.volume ?? 1, muted: c.muted ?? false }
}

function deepCloneAudioTrack(a: AudioTrack): AudioTrack {
  return { ...a }
}

function deepCloneTextClip(tc: TextClip): TextClip {
  return { ...tc, style: tc.style ? { ...tc.style } : undefined, words: deepCloneWords(tc.words) }
}

/** Capture current timeline + caption state for undo (deep clone) */
export function pushUndoSnapshot(): void {
  const { clips, audioTracks, textClips } = useTimeline.getState()
  useProject.getState().pushUndo({
    clips: clips.map(deepCloneClip),
    audioTracks: audioTracks.map(deepCloneAudioTrack),
    textClips: textClips.map(deepCloneTextClip),
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
// Style clipboard
// ---------------------------------------------------------------------------

let _styleClipboard: CaptionStyle | null = null
export function getStyleClipboard(): CaptionStyle | null { return _styleClipboard }

// ---------------------------------------------------------------------------
// In/Out points
// ---------------------------------------------------------------------------

let _inPointMs: number | null = null
let _outPointMs: number | null = null
export function getInPoint(): number | null { return _inPointMs }
export function getOutPoint(): number | null { return _outPointMs }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClipTransform {
  x: number; y: number
  scaleX: number; scaleY: number
  rotation: number
  opacity: number
  cropTop: number; cropBottom: number; cropLeft: number; cropRight: number
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
  solo: boolean
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
  speed: number
  /** Per-clip volume (0.0–1.0). Applied to native video audio track. */
  volume: number
  /** Per-clip mute. When true, native video audio is silenced. */
  muted: boolean
}

export interface AudioTrack {
  id: string
  path: string
  startMs: number
  durationMs: number
  volume: number
  muted: boolean
  name?: string
  role: 'voice' | 'music' | 'sfx' | 'ambient'
  /** Trim from start (ms) */
  trimStart: number
  /** Trim from end (ms) */
  trimEnd: number
  /** Track index for lane assignment */
  trackIndex: number
  /** Fade-in duration in milliseconds (0 = no fade). Applied via AudioParam scheduling. */
  fadeInMs?: number
  /** Fade-out duration in milliseconds (0 = no fade). Applied via AudioParam scheduling. */
  fadeOutMs?: number
}

/**
 * Compute whether an audio track is effectively muted given track-level
 * mute/solo state. SSOT — used by Preview, Export, Timeline waveform.
 */
export function computeEffectiveMuted(
  trackMuted: boolean,
  trackIndex: number,
  tracks: Track[]
): boolean {
  const hasSolo = tracks.some((l) => l.solo)
  const parentTrack = tracks.find((l) => l.kind === 'audio' && l.index === trackIndex)
  const laneMuted = parentTrack?.muted ?? false
  const laneSolo = parentTrack?.solo ?? false
  return trackMuted || laneMuted || (hasSolo && !laneSolo)
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
  wordTimestampsSource?: 'whisper' | 'synthetic'
  sourceId?: string
  sourceType?: 'clip' | 'audioTrack' | 'timeline' | 'import'
  transcriptionJobId?: string
  /** Original full word array preserved for non-destructive trim */
  originalWords?: Array<{ word: string; startMs: number; endMs: number }>
  /** Original startMs before any trim (for non-destructive caption trim) */
  originalStartMs?: number
  /** Original endMs before any trim */
  originalEndMs?: number
}

export function createTextClip(overrides: Partial<TextClip> & Pick<TextClip, 'text'>): TextClip {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 6)
  const startMs = overrides.startMs ?? 0
  const durationMs = overrides.durationMs ?? 3000
  return {
    id: overrides.id ?? `text_${ts}_${rand}`,
    startMs,
    durationMs,
    endMs: overrides.endMs ?? startMs + durationMs,
    trackIndex: overrides.trackIndex ?? 0,
    text: overrides.text,
    style: overrides.style,
    words: overrides.words,
    wordTimestampsSource: overrides.wordTimestampsSource,
    sourceId: overrides.sourceId,
    sourceType: overrides.sourceType,
    transcriptionJobId: overrides.transcriptionJobId,
  }
}

// ---------------------------------------------------------------------------
// State / Actions
// ---------------------------------------------------------------------------

export interface TimelineState {
  clips: Clip[]
  audioTracks: AudioTrack[]
  textClips: TextClip[]
  tracks: Track[]
  markers: TimelineMarker[]
  playheadMs: number
  totalDurationMs: number
  zoom: number
  isPlaying: boolean
  masterVolume: number
  // Unified selection (Phase 4)
  selectedIds: string[]
  focusedId: string | null
  anchorId: string | null
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
  setClipVolume: (clipId: string, volume: number) => void
  setClipMute: (clipId: string, muted: boolean) => void

  addAudioTrack: (track: AudioTrack) => void
  removeAudioTrack: (trackId: string) => void
  moveAudioTrack: (trackId: string, startMs: number) => void
  trimAudioTrack: (trackId: string, trimStart: number, trimEnd: number) => void
  setAudioVolume: (trackId: string, volume: number) => void
  toggleAudioMute: (trackId: string) => void
  setAudioFade: (trackId: string, fadeInMs: number, fadeOutMs: number) => void

  addTextClip: (clip: TextClip) => void
  addTextClips: (clips: TextClip[]) => void
  updateTextClip: (id: string, updates: Partial<TextClip>) => void
  deleteTextClip: (id: string) => void
  selectTextClip: (id: string | null) => void
  splitTextClip: (id: string, splitAtMs: number) => void

  beginDragCapture: () => void
  commitDrag: () => void
  cancelDrag: () => void
  moveClipLive: (clipId: string, startMs: number, trackIndex?: number) => void
  trimClipLive: (clipId: string, trimStart: number, trimEnd: number) => void
  updateTextClipLive: (id: string, updates: Partial<TextClip>) => void

  addTrack: (kind: Track['kind']) => void
  deleteTrack: (trackId: string) => void
  renameTrack: (trackId: string, name: string) => void
  toggleMuteTrack: (trackId: string) => void
  toggleLockTrack: (trackId: string) => void
  toggleHideTrack: (trackId: string) => void
  toggleSoloTrack: (trackId: string) => void

  addMarker: (marker: Omit<TimelineMarker, 'id'>) => void
  removeMarker: (markerId: string) => void
  clearMarkers: () => void

  setPlayhead: (ms: number) => void
  setZoom: (zoom: number) => void

  // Unified selection (Phase 4)
  selectClip: (clipId: string | null) => void
  toggleClipSelection: (clipId: string) => void
  selectClipRange: (clipId: string) => void
  selectAll: () => void
  deselectAll: () => void
  toggleTextClipSelection: (id: string) => void
  selectTextClipRange: (id: string) => void
  selectBox: (ids: string[]) => void
  isSelected: (id: string) => boolean

  copyStyle: () => void
  pasteStyle: () => void
  deleteSelected: () => void
  duplicateSelected: () => void
  moveSelectedClipsLive: (deltaMs: number, deltaTrack?: number) => void
  copySelection: () => void
  cutSelection: () => void
  pasteAtPlayhead: () => void
  setInPoint: (ms: number) => void
  setOutPoint: (ms: number) => void
  clearInOut: () => void
  rippleDeleteClip: (clipId: string) => void
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
    { id: 'track_v0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false, solo: false }
  ]
}

/** Find all selectable IDs across clips, textClips, audioTracks */
function getAllIds(state: TimelineState): string[] {
  return [
    ...state.clips.map((c) => c.id),
    ...state.textClips.map((tc) => tc.id),
    ...state.audioTracks.map((a) => a.id)
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
  isPlaying: false,
  masterVolume: 0.8,
  selectedIds: [],
  focusedId: null,
  anchorId: null
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
        if (clip.volume === undefined) clip.volume = 1.0
        if (clip.muted === undefined) clip.muted = false
        state.clips.push(clip)
        state.totalDurationMs = recalcDuration(state.clips)
        const exists = state.tracks.some((t) => t.kind === 'video' && t.index === clip.trackIndex)
        if (!exists) {
          state.tracks.push({
            id: `track_v${clip.trackIndex}`, index: clip.trackIndex,
            name: `Video ${clip.trackIndex + 1}`, kind: 'video',
            muted: false, locked: false, hidden: false, solo: false
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
          const prevTrimStart = clip.trimStart
          clip.trimStart = trimStart
          clip.trimEnd = trimEnd
          clip.durationMs = clip.sourceDurationMs - trimStart - trimEnd
          // Left trim: shift startMs to keep right edge anchored (Bug 2 fix)
          if (trimStart !== prevTrimStart) {
            clip.startMs = Math.max(0, clip.startMs + (trimStart - prevTrimStart))
          }
          state.totalDurationMs = recalcDuration(state.clips)
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
          const prevTrimStart = clip.trimStart
          clip.trimStart = trimStart
          clip.trimEnd = trimEnd
          clip.durationMs = clip.sourceDurationMs - trimStart - trimEnd
          // Left trim: shift startMs to keep right edge anchored (Bug 2 fix)
          if (trimStart !== prevTrimStart) {
            clip.startMs = Math.max(0, clip.startMs + (trimStart - prevTrimStart))
          }
          state.totalDurationMs = recalcDuration(state.clips)
        }
      })
    },

    deleteClip: (clipId) => {
      pushUndoSnapshot()
      set((state) => {
        state.clips = state.clips.filter((c) => c.id !== clipId)
        state.selectedIds = state.selectedIds.filter((id) => id !== clipId)
        if (state.focusedId === clipId) state.focusedId = null
        if (state.anchorId === clipId) state.anchorId = null
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    deleteSelected: () => {
      const { selectedIds } = useTimeline.getState()
      if (selectedIds.length === 0) return
      pushUndoSnapshot()
      set((state) => {
        const idSet = new Set(state.selectedIds)
        state.clips = state.clips.filter((c) => !idSet.has(c.id))
        state.textClips = state.textClips.filter((tc) => !idSet.has(tc.id))
        state.audioTracks = state.audioTracks.filter((a) => !idSet.has(a.id))
        state.selectedIds = []
        state.focusedId = null
        state.anchorId = null
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    duplicateClip: (clipId) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (!clip) return
        const newClip: Clip = {
          ...clip, id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          startMs: clip.startMs + clip.durationMs + 100,
          transform: deepCloneTransform(clip.transform),
          name: clip.name ? `${clip.name} (copy)` : 'Clip (copy)'
        }
        state.clips.push(newClip)
        state.totalDurationMs = recalcDuration(state.clips)
        state.selectedIds = [newClip.id]
        state.focusedId = newClip.id
        state.anchorId = newClip.id
      })
    },

    duplicateSelected: () => {
      const { selectedIds } = useTimeline.getState()
      if (selectedIds.length === 0) return
      pushUndoSnapshot()
      set((state) => {
        const newIds: string[] = []
        for (const id of state.selectedIds) {
          const clip = state.clips.find((c) => c.id === id)
          if (!clip) continue
          const newClip: Clip = {
            ...clip, id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            startMs: clip.startMs + clip.durationMs + 100,
            transform: deepCloneTransform(clip.transform),
            name: clip.name ? `${clip.name} (copy)` : 'Clip (copy)'
          }
          state.clips.push(newClip)
          newIds.push(newClip.id)
        }
        state.totalDurationMs = recalcDuration(state.clips)
        state.selectedIds = newIds
        state.focusedId = newIds[0] ?? null
        state.anchorId = newIds[0] ?? null
      })
    },

    moveSelectedClipsLive: (deltaMs, deltaTrack) => {
      set((state) => {
        const idSet = new Set(state.selectedIds)
        for (const clip of state.clips) {
          if (idSet.has(clip.id)) {
            clip.startMs = Math.max(0, clip.startMs + deltaMs)
            if (deltaTrack !== undefined) clip.trackIndex = Math.max(0, clip.trackIndex + deltaTrack)
          }
        }
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    copySelection: () => {
      const { clips, textClips, audioTracks, selectedIds } = useTimeline.getState()
      const idSet = new Set(selectedIds)
      _clipboard = {
        clips: clips.filter((c) => idSet.has(c.id)).map(deepCloneClip),
        audioTracks: audioTracks.filter((a) => idSet.has(a.id)).map(deepCloneAudioTrack),
        textClips: textClips.filter((tc) => idSet.has(tc.id)).map(deepCloneTextClip)
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
        const newIds: string[] = []
        if (_clipboard!.clips.length > 0) {
          const minStart = Math.min(..._clipboard!.clips.map((c) => c.startMs))
          const offset = playheadMs - minStart
          for (const orig of _clipboard!.clips) {
            const newId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            state.clips.push({ ...orig, id: newId, startMs: orig.startMs + offset, transform: deepCloneTransform(orig.transform) })
            newIds.push(newId)
          }
        }
        if (_clipboard!.textClips.length > 0) {
          const minStart = Math.min(..._clipboard!.textClips.map((tc) => tc.startMs))
          const offset = playheadMs - minStart
          for (const orig of _clipboard!.textClips) {
            const newId = `text_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            state.textClips.push({ ...orig, id: newId, startMs: orig.startMs + offset, endMs: orig.startMs + offset + orig.durationMs, style: orig.style ? { ...orig.style } : undefined, words: deepCloneWords(orig.words) })
          }
        }
        if (_clipboard!.audioTracks.length > 0) {
          const minStart = Math.min(..._clipboard!.audioTracks.map((a) => a.startMs))
          const offset = playheadMs - minStart
          for (const orig of _clipboard!.audioTracks) {
            const newId = `audio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
            state.audioTracks.push({ ...orig, id: newId, startMs: orig.startMs + offset })
          }
        }
        state.selectedIds = newIds
        state.focusedId = newIds[0] ?? null
        state.anchorId = newIds[0] ?? null
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    setInPoint: (ms) => { _inPointMs = ms },
    setOutPoint: (ms) => { _outPointMs = ms },
    clearInOut: () => { _inPointMs = null; _outPointMs = null },

    setMasterVolume: (volume) => set((state) => { state.masterVolume = Math.max(0, Math.min(1, volume)) }),

    rippleDeleteClip: (clipId) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (!clip) return
        const clipEnd = clip.startMs + clip.durationMs
        state.clips = state.clips.filter((c) => c.id !== clipId)
        for (const c of state.clips) { if (c.startMs >= clipEnd) c.startMs -= clip.durationMs }
        for (const tc of state.textClips) { if (tc.startMs >= clipEnd) { tc.startMs -= clip.durationMs; tc.endMs -= clip.durationMs } }
        for (const a of state.audioTracks) { if (a.startMs >= clipEnd) a.startMs -= clip.durationMs }
        state.selectedIds = state.selectedIds.filter((id) => id !== clipId)
        if (state.focusedId === clipId) state.focusedId = null
        if (state.anchorId === clipId) state.anchorId = null
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    splitClipAtPlayhead: () => {
      const { focusedId, playheadMs: ph, textClips } = useTimeline.getState()
      // Text clip split priority
      if (focusedId) {
        const textClip = textClips.find((tc) => tc.id === focusedId && ph > tc.startMs && ph < tc.endMs)
        if (textClip) { useTimeline.getState().splitTextClip(focusedId, ph); return }
        if (textClips.some((tc) => tc.id === focusedId)) return
      }
      pushUndoSnapshot()
      set((state) => {
        const { playheadMs, focusedId } = state
        let clipIndex = -1
        if (focusedId) {
          clipIndex = state.clips.findIndex((c) => c.id === focusedId && playheadMs >= c.startMs && playheadMs < c.startMs + c.durationMs)
        }
        if (clipIndex < 0) {
          clipIndex = state.clips.findIndex((c) => playheadMs >= c.startMs && playheadMs < c.startMs + c.durationMs)
        }
        if (clipIndex < 0) return
        const clip = state.clips[clipIndex]
        const splitPoint = playheadMs - clip.startMs
        clip.durationMs = splitPoint
        const newClip: Clip = {
          id: `${clip.id}_split_${Date.now()}`, path: clip.path, startMs: playheadMs,
          sourceDurationMs: clip.sourceDurationMs, durationMs: clip.durationMs - splitPoint + (clip.durationMs - splitPoint),
          trackIndex: clip.trackIndex, trimStart: clip.trimStart + splitPoint, trimEnd: clip.trimEnd,
          name: clip.name, transform: deepCloneTransform(clip.transform), speed: clip.speed,
          volume: clip.volume ?? 1, muted: clip.muted ?? false
        }
        newClip.durationMs = clip.sourceDurationMs - newClip.trimStart - newClip.trimEnd
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
        if (clip) clip.speed = Math.max(0.25, Math.min(4.0, speed))
      })
    },

    setClipVolume: (clipId, volume) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) clip.volume = Math.max(0, Math.min(1, volume))
      })
    },

    setClipMute: (clipId, muted) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) clip.muted = muted
      })
    },

    // -- Audio tracks (Phase 5: first-class citizens) --

    addAudioTrack: (track) => {
      pushUndoSnapshot()
      set((state) => {
        if (track.trimStart === undefined) track.trimStart = 0
        if (track.trimEnd === undefined) track.trimEnd = 0
        if (track.trackIndex === undefined) track.trackIndex = 0
        if (track.fadeInMs === undefined) track.fadeInMs = 0
        if (track.fadeOutMs === undefined) track.fadeOutMs = 0
        state.audioTracks.push(track)
        // Auto-create audio Track entry
        const idx = track.trackIndex
        if (!state.tracks.some((t) => t.kind === 'audio' && t.index === idx)) {
          state.tracks.push({
            id: `track_audio_${idx}`, index: idx, name: track.name ?? `Audio ${idx + 1}`,
            kind: 'audio', muted: false, locked: false, hidden: false, solo: false
          })
        }
      })
    },

    removeAudioTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        state.audioTracks = state.audioTracks.filter((t) => t.id !== trackId)
        state.selectedIds = state.selectedIds.filter((id) => id !== trackId)
        if (state.focusedId === trackId) state.focusedId = null
      })
    },

    moveAudioTrack: (trackId, startMs) =>
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) track.startMs = Math.max(0, startMs)
      }),

    trimAudioTrack: (trackId, trimStart, trimEnd) =>
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) {
          track.trimStart = trimStart
          track.trimEnd = trimEnd
          track.durationMs = Math.max(100, track.durationMs)
        }
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

    setAudioFade: (trackId, fadeInMs, fadeOutMs) =>
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) {
          track.fadeInMs = Math.max(0, fadeInMs)
          track.fadeOutMs = Math.max(0, fadeOutMs)
        }
      }),

    // -- Text Clips --

    addTextClip: (clip) => {
      pushUndoSnapshot()
      set((state) => {
        state.textClips.push(clip)
        const hasCaptionTrack = state.tracks.some((t) => t.kind === 'caption')
        if (!hasCaptionTrack) {
          state.tracks.push({ id: 'track_caption_0', index: 0, name: 'Captions', kind: 'caption', muted: false, locked: false, hidden: false, solo: false })
        }
      })
    },

    addTextClips: (clips) => {
      if (clips.length === 0) return
      pushUndoSnapshot()
      set((state) => {
        for (const clip of clips) state.textClips.push(clip)
        const hasCaptionTrack = state.tracks.some((t) => t.kind === 'caption')
        if (!hasCaptionTrack) {
          state.tracks.push({ id: 'track_caption_0', index: 0, name: 'Captions', kind: 'caption', muted: false, locked: false, hidden: false, solo: false })
        }
      })
    },

    updateTextClip: (id, updates) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.textClips.find((c) => c.id === id)
        if (clip) {
          // Non-destructive caption trim (Phase 6): preserve originals on first trim
          const isTrim = updates.startMs !== undefined || updates.endMs !== undefined
          if (isTrim) {
            if (!clip.originalWords && clip.words) {
              clip.originalWords = clip.words.map((w) => ({ ...w }))
            }
            if (clip.originalStartMs === undefined) {
              clip.originalStartMs = clip.startMs
            }
            if (clip.originalEndMs === undefined) {
              clip.originalEndMs = clip.endMs
            }
          }
          Object.assign(clip, updates)
          if (updates.startMs !== undefined || updates.durationMs !== undefined) {
            clip.endMs = clip.startMs + clip.durationMs
          }
        }
      })
    },

    updateTextClipLive: (id, updates) => {
      set((state) => {
        const clip = state.textClips.find((c) => c.id === id)
        if (clip) {
          // Non-destructive caption trim (Phase 6): preserve originals on first trim
          const isTrim = updates.startMs !== undefined || updates.endMs !== undefined
          if (isTrim) {
            if (!clip.originalWords && clip.words) {
              clip.originalWords = clip.words.map((w) => ({ ...w }))
            }
            if (clip.originalStartMs === undefined) {
              clip.originalStartMs = clip.startMs
            }
            if (clip.originalEndMs === undefined) {
              clip.originalEndMs = clip.endMs
            }
          }
          Object.assign(clip, updates)
          if (updates.startMs !== undefined || updates.durationMs !== undefined) {
            clip.endMs = clip.startMs + clip.durationMs
          }
        }
      })
    },

    deleteTextClip: (id) => {
      pushUndoSnapshot()
      set((state) => {
        state.textClips = state.textClips.filter((c) => c.id !== id)
        state.selectedIds = state.selectedIds.filter((tid) => tid !== id)
        if (state.focusedId === id) state.focusedId = null
        if (state.anchorId === id) state.anchorId = null
      })
    },

    selectTextClip: (id) => {
      set((state) => {
        state.selectedIds = id ? [id] : []
        state.focusedId = id
        state.anchorId = id
      })
    },

    splitTextClip: (id, splitAtMs) => {
      pushUndoSnapshot()
      set((state) => {
        const idx = state.textClips.findIndex((c) => c.id === id)
        if (idx < 0) return
        const clip = state.textClips[idx]
        const relativeSplit = splitAtMs - clip.startMs
        let firstWords = clip.words
        let secondWords = clip.words
        if (clip.words && clip.words.length > 0) {
          firstWords = clip.words.filter((w) => w.endMs <= relativeSplit)
          secondWords = clip.words.filter((w) => w.endMs > relativeSplit).map((w) => ({ ...w, startMs: w.startMs - relativeSplit, endMs: w.endMs - relativeSplit }))
        }
        const firstText = firstWords && firstWords.length > 0 ? firstWords.map((w) => w.word).join(' ') : clip.text
        const secondText = secondWords && secondWords.length > 0 ? secondWords.map((w) => w.word).join(' ') : clip.text

        // Non-destructive trim: propagate originals to split children
        const hasOriginals = clip.originalWords && clip.originalStartMs !== undefined && clip.originalEndMs !== undefined
        const origWords = clip.originalWords
        const origStart = clip.originalStartMs
        const origEnd = clip.originalEndMs

        const first: TextClip = {
          id: `${clip.id}_a`, startMs: clip.startMs, durationMs: splitAtMs - clip.startMs, endMs: splitAtMs,
          trackIndex: clip.trackIndex, text: firstText, style: clip.style ? { ...clip.style } : undefined,
          words: firstWords, wordTimestampsSource: clip.wordTimestampsSource,
          sourceId: clip.sourceId, sourceType: clip.sourceType, transcriptionJobId: clip.transcriptionJobId,
          originalWords: hasOriginals ? origWords?.filter((w) => w.endMs <= relativeSplit) : undefined,
          originalStartMs: hasOriginals ? origStart : undefined,
          originalEndMs: hasOriginals ? Math.min(origEnd!, splitAtMs) : undefined
        }
        const second: TextClip = {
          id: `${clip.id}_b`, startMs: splitAtMs, durationMs: clip.endMs - splitAtMs, endMs: clip.endMs,
          trackIndex: clip.trackIndex, text: secondText, style: clip.style ? { ...clip.style } : undefined,
          words: secondWords, wordTimestampsSource: clip.wordTimestampsSource,
          sourceId: clip.sourceId, sourceType: clip.sourceType, transcriptionJobId: clip.transcriptionJobId,
          originalWords: hasOriginals ? origWords?.filter((w) => w.endMs > relativeSplit).map((w) => ({ ...w, startMs: w.startMs - relativeSplit, endMs: w.endMs - relativeSplit })) : undefined,
          originalStartMs: hasOriginals ? Math.max(origStart!, splitAtMs) : undefined,
          originalEndMs: hasOriginals ? origEnd : undefined
        }
        state.textClips.splice(idx, 1, first, second)
      })
    },

    // -- Track management --

    addTrack: (kind) => set((state) => {
      const existingOfKind = state.tracks.filter((t) => t.kind === kind)
      const maxIndex = existingOfKind.reduce((m, t) => Math.max(m, t.index), -1)
      const newIndex = maxIndex + 1
      const label = kind.charAt(0).toUpperCase() + kind.slice(1)
      state.tracks.push({
        id: `track_${kind}_${uuid().slice(0, 8)}`, index: newIndex,
        name: `${label} ${newIndex + 1}`, kind, muted: false, locked: false, hidden: false, solo: false
      })
    }),

    deleteTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (!track) return
        if (track.kind === 'video') {
          state.clips = state.clips.filter((c) => c.trackIndex !== track.index)
        }
        state.tracks = state.tracks.filter((t) => t.id !== trackId)
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    renameTrack: (trackId, name) => set((state) => {
      const track = state.tracks.find((t) => t.id === trackId)
      if (track) track.name = name
    }),

    toggleMuteTrack: (trackId) => set((state) => {
      const track = state.tracks.find((t) => t.id === trackId)
      if (track) track.muted = !track.muted
    }),

    toggleLockTrack: (trackId) => set((state) => {
      const track = state.tracks.find((t) => t.id === trackId)
      if (track) track.locked = !track.locked
    }),

    toggleHideTrack: (trackId) => set((state) => {
      const track = state.tracks.find((t) => t.id === trackId)
      if (track) track.hidden = !track.hidden
    }),

    toggleSoloTrack: (trackId) => set((state) => {
      const track = state.tracks.find((t) => t.id === trackId)
      if (track) track.solo = !track.solo
    }),

    // -- Markers --
    addMarker: (marker) => set((state) => { state.markers.push({ ...marker, id: `marker_${Date.now()}` }) }),
    removeMarker: (markerId) => set((state) => { state.markers = state.markers.filter((m) => m.id !== markerId) }),
    clearMarkers: () => set((state) => { state.markers = [] }),

    // -- Playback --
    setPlayhead: (ms) => set((state) => { state.playheadMs = Math.max(0, ms) }),
    setZoom: (zoom) => set((state) => { state.zoom = Math.max(0.1, Math.min(10, zoom)) }),
    setPlaying: (playing) => set((state) => { state.isPlaying = playing }),

    // -- Unified Selection (Phase 4) --

    selectClip: (clipId) => set((state) => {
      state.selectedIds = clipId ? [clipId] : []
      state.focusedId = clipId
      state.anchorId = clipId
    }),

    toggleClipSelection: (clipId) => set((state) => {
      const idx = state.selectedIds.indexOf(clipId)
      if (idx >= 0) {
        state.selectedIds.splice(idx, 1)
        if (state.focusedId === clipId) {
          state.focusedId = state.selectedIds.length > 0 ? state.selectedIds[state.selectedIds.length - 1] : null
        }
      } else {
        state.selectedIds.push(clipId)
        state.focusedId = clipId
      }
      state.anchorId = clipId
    }),

    selectClipRange: (clipId) => set((state) => {
      const allSorted = [...state.clips].sort((a, b) => a.startMs - b.startMs)
      const anchorId = state.anchorId ?? state.focusedId
      const anchorIdx = anchorId ? allSorted.findIndex((c) => c.id === anchorId) : -1
      const targetIdx = allSorted.findIndex((c) => c.id === clipId)
      if (anchorIdx >= 0 && targetIdx >= 0) {
        const lo = Math.min(anchorIdx, targetIdx)
        const hi = Math.max(anchorIdx, targetIdx)
        const rangeIds = allSorted.slice(lo, hi + 1).map((c) => c.id)
        const idSet = new Set([...state.selectedIds, ...rangeIds])
        state.selectedIds = [...idSet]
      } else if (targetIdx >= 0) {
        if (!state.selectedIds.includes(clipId)) state.selectedIds.push(clipId)
      }
      state.focusedId = clipId
    }),

    selectAll: () => set((state) => {
      state.selectedIds = getAllIds(state)
      state.focusedId = state.selectedIds[0] ?? null
      state.anchorId = state.focusedId
    }),

    deselectAll: () => set((state) => {
      state.selectedIds = []
      state.focusedId = null
      state.anchorId = null
    }),

    toggleTextClipSelection: (id) => set((state) => {
      const idx = state.selectedIds.indexOf(id)
      if (idx >= 0) {
        state.selectedIds.splice(idx, 1)
        if (state.focusedId === id) {
          state.focusedId = state.selectedIds.length > 0 ? state.selectedIds[state.selectedIds.length - 1] : null
        }
      } else {
        state.selectedIds.push(id)
        state.focusedId = id
      }
      state.anchorId = id
    }),

    selectTextClipRange: (id) => set((state) => {
      const sorted = [...state.textClips].sort((a, b) => a.startMs - b.startMs)
      const anchorId = state.anchorId ?? state.focusedId
      const anchorIdx = anchorId ? sorted.findIndex((tc) => tc.id === anchorId) : -1
      const targetIdx = sorted.findIndex((tc) => tc.id === id)
      if (anchorIdx >= 0 && targetIdx >= 0) {
        const lo = Math.min(anchorIdx, targetIdx)
        const hi = Math.max(anchorIdx, targetIdx)
        const rangeIds = sorted.slice(lo, hi + 1).map((tc) => tc.id)
        const idSet = new Set([...state.selectedIds, ...rangeIds])
        state.selectedIds = [...idSet]
      } else if (targetIdx >= 0) {
        if (!state.selectedIds.includes(id)) state.selectedIds.push(id)
      }
      state.focusedId = id
    }),

    selectBox: (ids) => set((state) => {
      state.selectedIds = ids
      state.focusedId = ids.length > 0 ? ids[0] : null
      state.anchorId = state.focusedId
    }),

    isSelected: (id) => {
      return useTimeline.getState().selectedIds.includes(id)
    },

    // -- Style --

    copyStyle: () => {
      const { focusedId, textClips } = useTimeline.getState()
      const { activeStyle } = useCaption.getState()
      const clip = focusedId ? textClips.find((tc) => tc.id === focusedId) : null
      _styleClipboard = { ...(clip?.style ?? activeStyle) }
    },

    pasteStyle: () => {
      if (!_styleClipboard) return
      pushUndoSnapshot()
      const { selectedIds } = useTimeline.getState()
      const styleToApply = { ..._styleClipboard }
      set((state) => {
        const idSet = new Set(selectedIds)
        for (const tc of state.textClips) {
          if (idSet.has(tc.id)) tc.style = { ...styleToApply }
        }
      })
      useCaption.getState().applyStyle(styleToApply)
    },

    // -- Deferred undo --

    beginDragCapture: () => {
      const { clips, audioTracks, textClips } = useTimeline.getState()
      _dragPreClips = clips.map(deepCloneClip)
      _dragPreAudioTracks = audioTracks.map(deepCloneAudioTrack)
      _dragPreTextClips = textClips.map(deepCloneTextClip)
    },

    commitDrag: () => {
      if (!_dragPreClips) return
      useProject.getState().pushUndo({
        clips: _dragPreClips, audioTracks: _dragPreAudioTracks!, textClips: _dragPreTextClips!,
        captions: _dragPreTextClips!.map((tc) => ({ id: tc.id, startMs: tc.startMs, endMs: tc.endMs, text: tc.text }))
      })
      _dragPreClips = null; _dragPreAudioTracks = null; _dragPreTextClips = null
    },

    cancelDrag: () => {
      if (!_dragPreClips) return
      const preClips = _dragPreClips
      const preAudio = _dragPreAudioTracks!
      const preText = _dragPreTextClips!
      _dragPreClips = null; _dragPreAudioTracks = null; _dragPreTextClips = null
      set((state) => {
        state.clips.length = 0; state.clips.push(...preClips)
        state.audioTracks.length = 0; state.audioTracks.push(...preAudio)
        state.textClips.length = 0; state.textClips.push(...preText)
        state.totalDurationMs = recalcDuration(state.clips)
      })
    },

    clearTimeline: () => {
      _clipboard = null; _inPointMs = null; _outPointMs = null
      clearWaveformCache()
      set(() => ({ ...initialState, tracks: makeDefaultTracks() }))
    },

    loadTimeline: (data) => set((state) => {
      // Forward-compatible migration: ensure volume/muted/speed defaults
      // for .ecp files saved before these fields existed.
      state.clips = (data.clips || []).map((c) => ({
        ...c,
        volume: c.volume ?? 1,
        muted: c.muted ?? false,
        speed: c.speed ?? 1
      }))
      state.audioTracks = (data.audioTracks || []).map((t) => ({
        ...t,
        fadeInMs: t.fadeInMs ?? 0,
        fadeOutMs: t.fadeOutMs ?? 0
      }))
      state.textClips = data.textClips || []
      state.totalDurationMs = recalcDuration(state.clips)
    }),

    recalcTotalDuration: () => set((state) => { state.totalDurationMs = recalcDuration(state.clips) })
  }))
)
