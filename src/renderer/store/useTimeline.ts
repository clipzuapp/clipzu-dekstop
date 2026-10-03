import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { useProject, type UndoSnapshot } from './useProject'
import { clearWaveformCache } from '../services/WaveformService'
import { useCaption, type CaptionStyle } from './useCaption'
import {
  recalcTimelineDuration,
  applyTextClipMutations,
  normalizeTextClip,
  getTextClipEnd,
  shiftTextClipStart
} from '../../shared/utils/timeline'
import type { KeyframeTrack } from '../effects/types/Keyframe'
import type { Modifier, ModifierPatch } from '../effects/types/Modifier'

export {
  recalcTimelineDuration,
  getTextClipEnd,
  normalizeTextClip,
  applyTextClipMutations,
  shiftTextClipStart
} from '../../shared/utils/timeline'

function uuid(): string {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ---------------------------------------------------------------------------
// Deep clone helpers — used ONLY where an independent copy is semantically
// required (clipboard copy, duplicate, paste, split). Undo snapshots do NOT
// clone (see pushUndoSnapshot): structural sharing instead.
// ---------------------------------------------------------------------------

function deepCloneTransform(t?: ClipTransform): ClipTransform | undefined {
  return t ? { ...t } : undefined
}

function deepCloneWords(w?: TextClip['words']): TextClip['words'] {
  return w ? w.map((wd) => ({ ...wd })) : undefined
}

function deepCloneKeyframes(kf?: KeyframeTrack[]): KeyframeTrack[] | undefined {
  return kf ? kf.map((t) => ({ property: t.property, frames: t.frames.map((f) => ({ ...f })) })) : undefined
}

function deepCloneModifiers(mods?: Modifier[]): Modifier[] | undefined {
  return mods ? mods.map((m) => ({ ...m, parameters: { ...m.parameters }, keyframes: deepCloneKeyframes(m.keyframes) ?? [] })) : undefined
}

function deepCloneClip(c: Clip): Clip {
  return {
    ...c, transform: deepCloneTransform(c.transform), volume: c.volume ?? 1, muted: c.muted ?? false,
    keyframes: deepCloneKeyframes(c.keyframes), modifiers: deepCloneModifiers(c.modifiers),
    outTransition: c.outTransition ? { ...c.outTransition } : undefined
  }
}

function deepCloneAudioTrack(a: AudioTrack): AudioTrack {
  return { ...a, keyframes: deepCloneKeyframes(a.keyframes) }
}

function deepCloneTextClip(tc: TextClip): TextClip {
  return {
    ...tc, style: tc.style ? { ...tc.style } : undefined, words: deepCloneWords(tc.words),
    keyframes: deepCloneKeyframes(tc.keyframes)
  }
}

/**
 * Capture current timeline + caption state for undo WITHOUT cloning.
 *
 * Structural sharing: the snapshot holds the LIVE array/object references.
 * This is safe because every timeline mutation flows through immer `set()`
 * producers (verified by audit — no out-of-producer writes exist), and immer
 * copies-on-write: committed state is never mutated in place, so a stored
 * reference keeps its captured values forever. Result: O(1) snapshot instead
 * of O(n) deep clone per edit (a 1h timeline with word-level captions went
 * from ~ms+GC churn per keystroke to pointer copies).
 *
 * Safety net: in non-production builds the snapshot is deep-frozen, so any
 * future out-of-producer mutation throws loudly in dev/test instead of
 * silently corrupting undo history. (Production skips the freeze walk;
 * correctness does not depend on it.)
 */
export function captureTimelineSnapshot(): {
  clips: Clip[]
  audioTracks: AudioTrack[]
  textClips: TextClip[]
  captions: Array<{ id: string; startMs: number; endMs: number; text: string }>
  tracks: Track[]
  markers: TimelineMarker[]
} {
  const { clips, audioTracks, textClips, tracks, markers } = useTimeline.getState()
  const snapshot = {
    clips,
    audioTracks,
    textClips,
    captions: textClips.map((tc) => ({
      id: tc.id, startMs: tc.startMs, endMs: getTextClipEnd(tc), text: tc.text
    })),
    tracks,
    markers
  }
  freezeUndoSnapshot(snapshot)
  return snapshot
}

/** Push the current state as an undo entry (shared refs — see above). */
export function pushUndoSnapshot(): void {
  useProject.getState().pushUndo(captureTimelineSnapshot())
}

/**
 * Apply an undo/redo snapshot to the live timeline (SSOT for ALL undo
 * entry points: Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y, toolbar buttons). Previously
 * each call site hand-rolled this — and the toolbar buttons forgot the
 * apply step entirely, silently EATING history entries without restoring.
 */
export function applySnapshotToTimeline(snapshot: UndoSnapshot): void {
  useTimeline.setState({
    clips: snapshot.clips,
    audioTracks: snapshot.audioTracks,
    textClips: snapshot.textClips,
    ...(snapshot.tracks ? { tracks: snapshot.tracks } : {}),
    ...(snapshot.markers ? { markers: snapshot.markers } : {})
  })
  useTimeline.getState().recalcTotalDuration()
}

/**
 * Full undo operation: capture current (for redo), pop, apply.
 * Returns false when history is empty. Single source for hotkeys + toolbar.
 */
export function performUndo(): boolean {
  const snapshot = useProject.getState().undo(captureTimelineSnapshot())
  if (!snapshot) return false
  applySnapshotToTimeline(snapshot)
  return true
}

/** Full redo operation: mirror image of performUndo. */
export function performRedo(): boolean {
  const snapshot = useProject.getState().redo(captureTimelineSnapshot())
  if (!snapshot) return false
  applySnapshotToTimeline(snapshot)
  return true
}

/** Deep-freeze an undo snapshot (dev/test only — loud on violation). */
export function freezeUndoSnapshot(snapshot: object): void {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return
  const seen = new Set<object>()
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const obj = value as object
    if (seen.has(obj)) return
    seen.add(obj)
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item)
    } else {
      for (const item of Object.values(obj)) walk(item)
    }
    Object.freeze(obj)
  }
  walk(snapshot)
}

// ---------------------------------------------------------------------------
// Deferred undo — captures pre-interaction state for drag/trim operations
// ---------------------------------------------------------------------------

let _dragPreClips: Clip[] | null = null
let _dragPreAudioTracks: AudioTrack[] | null = null
let _dragPreTextClips: TextClip[] | null = null
let _dragPreTracks: Track[] | null = null
let _dragPreMarkers: TimelineMarker[] | null = null

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
/** Clear the style clipboard (project load/reset boundary — no stale paste). */
export function clearStyleClipboard(): void { _styleClipboard = null }

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
  /** Whether the source media contains a native audio stream. */
  hasAudio?: boolean
  transform?: ClipTransform
  speed: number
  /** Per-clip linear volume (0.0–2.0). 1.0 = 0 dB (unity), 2.0 = +6 dB (boost). */
  volume: number
  /** Per-clip mute. When true, native video audio is silenced. */
  muted: boolean
  /** Fade-in duration in milliseconds (0 = no fade). Rendered as edge triangle on timeline. */
  fadeInMs?: number
  /** Fade-out duration in milliseconds (0 = no fade). Rendered as edge triangle on timeline. */
  fadeOutMs?: number
  /** Keyframe animation tracks for property-level animation. */
  keyframes?: KeyframeTrack[]
  /** Active modifiers (effects/filters) on this clip. */
  modifiers?: Modifier[]
  /** Transition applied at the OUT point of this clip (overlap with next clip on same track). */
  outTransition?: { type: string; durationMs: number }
  /** CSS blend mode for multi-layer compositing. Only effective on tracks above index 0. */
  blendMode?: BlendMode
  /** Path to low-res proxy file (720p). Used for timeline preview; export always uses `path`. */
  proxyPath?: string
}

/** Supported CSS blend modes for clip compositing. */
export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'soft-light' | 'difference'

export interface AudioTrack {
  id: string
  path: string
  startMs: number
  /** Original media file duration (before any trim). Immutable after creation. */
  sourceDurationMs: number
  /** Display duration after trim = sourceDurationMs - trimStart - trimEnd */
  durationMs: number
  /** Linear volume (0.0–2.0). 1.0 = 0 dB (unity), 2.0 = +6 dB (boost). */
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
  /** Keyframe animation tracks for volume/pan automation. */
  keyframes?: KeyframeTrack[]
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

/**
 * Compute whether a video clip should be hidden/skipped given track-level
 * hidden and solo state. SSOT — used by Preview, Export, Timeline canvas.
 * A clip is suppressed when its track is hidden, OR when another video track
 * has solo active and this track doesn't.
 */
export function computeEffectiveVideoHidden(
  trackIndex: number,
  tracks: Track[]
): boolean {
  const videoTracks = tracks.filter((l) => l.kind === 'video')
  const parentTrack = videoTracks.find((l) => l.index === trackIndex)
  const isHidden = parentTrack?.hidden ?? false
  const hasSolo = videoTracks.some((l) => l.solo)
  const isSolo = parentTrack?.solo ?? false
  return isHidden || (hasSolo && !isSolo)
}

/**
 * Compute whether a video clip's native audio should be suppressed given
 * track-level mute and solo state. SSOT — used by Preview and Export.
 * Suppresses audio when: clip is muted, OR video track is muted, OR a sibling
 * video track has solo active and this track doesn't. (req 2.9 / F2)
 */
export function computeEffectiveVideoMuted(
  clipMuted: boolean,
  trackIndex: number,
  tracks: Track[]
): boolean {
  const videoTracks = tracks.filter((l) => l.kind === 'video')
  const parentTrack = videoTracks.find((l) => l.index === trackIndex)
  const trackMuted = parentTrack?.muted ?? false
  const hasSolo = videoTracks.some((l) => l.solo)
  const isSolo = parentTrack?.solo ?? false
  return clipMuted || trackMuted || (hasSolo && !isSolo)
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
  /** Fade-in duration in milliseconds (0 = no fade). Rendered as edge triangle on timeline. */
  fadeInMs?: number
  /** Fade-out duration in milliseconds (0 = no fade). Rendered as edge triangle on timeline. */
  fadeOutMs?: number
  /** Keyframe animation tracks for position/scale/opacity animation. */
  keyframes?: KeyframeTrack[]
}

export function createTextClip(overrides: Partial<TextClip> & Pick<TextClip, 'text'>): TextClip {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 6)
  const startMs = overrides.startMs ?? 0
  const durationMs = overrides.durationMs ?? (overrides.endMs !== undefined ? overrides.endMs - startMs : 3000)
  return normalizeTextClip({
    id: overrides.id ?? `text_${ts}_${rand}`,
    startMs,
    durationMs,
    endMs: startMs + durationMs,
    trackIndex: overrides.trackIndex ?? 0,
    text: overrides.text,
    style: overrides.style,
    words: overrides.words,
    wordTimestampsSource: overrides.wordTimestampsSource,
    sourceId: overrides.sourceId,
    sourceType: overrides.sourceType,
    transcriptionJobId: overrides.transcriptionJobId,
  })
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
/** Master volume range. 0 = silence, 1.0 = 0 dB (unity). No boost on master. */
  masterVolume: number
  /** When true, playback loops between in/out points if set, otherwise timeline bounds. */
  loopEnabled: boolean
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
  setClipName: (clipId: string, name: string) => void
  setClipFade: (clipId: string, fadeInMs: number, fadeOutMs: number) => void

  addAudioTrack: (track: AudioTrack) => void
  addMediaBatch: (clips: Clip[], audioTracks: AudioTrack[]) => void
  removeAudioTrack: (trackId: string) => void
  moveAudioTrack: (trackId: string, startMs: number, trackIndex?: number) => void
  setAudioName: (trackId: string, name: string) => void
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
  setTextFade: (id: string, fadeInMs: number, fadeOutMs: number) => void

  beginDragCapture: () => void
  commitDrag: () => void
  cancelDrag: () => void
  moveClipLive: (clipId: string, startMs: number, trackIndex?: number) => void
  moveAudioTrackLive: (trackId: string, startMs: number, trackIndex?: number) => void
  trimClipLive: (clipId: string, trimStart: number, trimEnd: number) => void
  updateTextClipLive: (id: string, updates: Partial<TextClip>) => void

  addTrack: (kind: Track['kind']) => void
  deleteTrack: (trackId: string) => void
  moveTrack: (trackId: string, direction: 'up' | 'down') => void
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
  toggleLoop: () => void
  clearTimeline: () => void
  loadTimeline: (data: { clips: Clip[]; audioTracks: AudioTrack[]; textClips?: TextClip[]; tracks?: Track[]; markers?: TimelineMarker[]; playheadMs?: number; zoom?: number; masterVolume?: number; loopEnabled?: boolean }) => void
  recalcTotalDuration: () => void

  // Keyframe actions
  setClipKeyframes: (clipId: string, keyframes: KeyframeTrack[]) => void
  removeClipKeyframeTrack: (clipId: string, property: string) => void
  addKeyframeAtPlayhead: (entityId: string, property: string, value: number) => void
  setAudioKeyframes: (trackId: string, keyframes: KeyframeTrack[]) => void
  setTextClipKeyframes: (textClipId: string, keyframes: KeyframeTrack[]) => void

  // Modifier actions (effects/filters)
  addClipModifier: (clipId: string, modifier: Modifier) => void
  removeClipModifier: (clipId: string, modifierId: string) => void
  updateClipModifier: (clipId: string, modifierId: string, patch: ModifierPatch) => void
  reorderClipModifier: (clipId: string, fromIndex: number, toIndex: number) => void

  // Transition actions
  setClipOutTransition: (clipId: string, transition: { type: string; durationMs: number } | null) => void

  // Blend mode
  setClipBlendMode: (clipId: string, mode: BlendMode) => void

  // Proxy
  /** Set proxy path for a clip (called asynchronously after proxy generation). No undo snapshot. */
  setClipProxyPath: (clipId: string, proxyPath: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function syncTotalDuration(state: TimelineState): void {
  state.totalDurationMs = recalcTimelineDuration(state)
}

/**
 * O(1) total-duration update for operations that can only GROW the timeline
 * (addClip, duplicate, addAudioTrack, split). If the new end exceeds the
 * current total, update; otherwise the total is unchanged.
 */
function growTotalDuration(state: TimelineState, endMs: number): void {
  if (endMs > state.totalDurationMs) state.totalDurationMs = endMs
}

function makeDefaultTracks(): Track[] {
  return [
    { id: 'track_v0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false, solo: false }
  ]
}

/**
 * P2.5: ensure one `track_caption_<i>` record per used caption lane.
 * Called by addTextClip(s) and loadTimeline normalization so every caption
 * row has a real Track record (working mute/solo/lock/hide/rename/delete).
 * Idempotent — never duplicates. Old files (all lane 0) gain exactly one
 * `track_caption_0` record; placement, styles, and timing are untouched.
 */
function ensureCaptionTrackRecords(state: { tracks: Track[]; textClips: Array<{ trackIndex: number }> }): void {
  const lanes = [...new Set(state.textClips.map((tc) => tc.trackIndex))].sort((a, b) => a - b)
  for (const lane of lanes) {
    if (!state.tracks.some((t) => t.kind === 'caption' && t.index === lane)) {
      state.tracks.push({
        id: `track_caption_${lane}`, index: lane,
        name: lane === 0 ? 'Captions' : `Captions ${lane + 1}`,
        kind: 'caption', muted: false, locked: false, hidden: false, solo: false
      })
    }
  }
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
  loopEnabled: false,
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
        // Canonical shape from birth: save→load must be identity, so creation
        // defaults match the schema normalizer exactly (same as audio below).
        if (clip.fadeInMs === undefined) clip.fadeInMs = 0
        if (clip.fadeOutMs === undefined) clip.fadeOutMs = 0
        state.clips.push(clip)
        growTotalDuration(state, clip.startMs + clip.durationMs)
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
          syncTotalDuration(state)
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
          syncTotalDuration(state)
        }
      })
    },

    moveClipLive: (clipId, startMs, trackIndex) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.startMs = Math.max(0, startMs)
          if (trackIndex !== undefined) clip.trackIndex = trackIndex
          syncTotalDuration(state)
        }
      })
    },

    moveAudioTrackLive: (trackId, startMs, trackIndex) => {
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) {
          track.startMs = Math.max(0, startMs)
          if (trackIndex !== undefined) track.trackIndex = Math.max(0, Math.floor(trackIndex))
          syncTotalDuration(state)
        }
      })
    },

    setAudioName: (trackId, name) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) track.name = name
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
          syncTotalDuration(state)
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
        syncTotalDuration(state)
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
        syncTotalDuration(state)
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
        growTotalDuration(state, newClip.startMs + newClip.durationMs)
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
        // O(1) grow: duplicates always extend the timeline
        let maxEnd = state.totalDurationMs
        for (const id of newIds) {
          const c = state.clips.find((x) => x.id === id)
          if (c) maxEnd = Math.max(maxEnd, c.startMs + c.durationMs)
        }
        state.totalDurationMs = maxEnd
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
        syncTotalDuration(state)
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
            state.textClips.push(normalizeTextClip({
              ...orig,
              id: newId,
              startMs: orig.startMs + offset,
              durationMs: orig.durationMs,
              endMs: orig.startMs + offset + orig.durationMs,
              style: orig.style ? { ...orig.style } : undefined,
              words: deepCloneWords(orig.words)
            }))
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
        syncTotalDuration(state)
      })
    },

    setInPoint: (ms) => { _inPointMs = ms },
    setOutPoint: (ms) => { _outPointMs = ms },
    clearInOut: () => { _inPointMs = null; _outPointMs = null },

    setMasterVolume: (volume) => set((state) => { state.masterVolume = Math.max(0, Math.min(1, volume)) }),

    toggleLoop: () => set((state) => { state.loopEnabled = !state.loopEnabled }),

    rippleDeleteClip: (clipId) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (!clip) return
        const clipEnd = clip.startMs + clip.durationMs
        state.clips = state.clips.filter((c) => c.id !== clipId)
        for (const c of state.clips) { if (c.startMs >= clipEnd) c.startMs -= clip.durationMs }
        for (const tc of state.textClips) {
          if (tc.startMs >= clipEnd) shiftTextClipStart(tc, -clip.durationMs)
        }
        for (const a of state.audioTracks) { if (a.startMs >= clipEnd) a.startMs -= clip.durationMs }
        state.selectedIds = state.selectedIds.filter((id) => id !== clipId)
        if (state.focusedId === clipId) state.focusedId = null
        if (state.anchorId === clipId) state.anchorId = null
        syncTotalDuration(state)
      })
    },

    splitClipAtPlayhead: () => {
      const { focusedId, playheadMs: ph, textClips } = useTimeline.getState()
      // Text clip split priority
      if (focusedId) {
        const textClip = textClips.find((tc) => tc.id === focusedId && ph > tc.startMs && ph < getTextClipEnd(tc))
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
          volume: clip.volume ?? 1, muted: clip.muted ?? false,
          // Canonical shape from birth (see addClip): a split point carries no
          // fade, and audio presence inherits the source clip.
          fadeInMs: 0, fadeOutMs: 0, hasAudio: clip.hasAudio ?? true
        }
        newClip.durationMs = clip.sourceDurationMs - newClip.trimStart - newClip.trimEnd
        state.clips.splice(clipIndex + 1, 0, newClip)
        syncTotalDuration(state)
      })
    },

    setClipTransform: (clipId, transform) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          if (!clip.transform) clip.transform = { ...DEFAULT_TRANSFORM }
          Object.assign(clip.transform, transform)
        }
      })
    },

    setClipSpeed: (clipId, speed) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) clip.speed = Math.max(0.25, Math.min(4.0, speed))
      })
    },

    setClipVolume: (clipId, volume) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) clip.volume = Math.max(0, Math.min(2.0, volume))
      })
    },

    setClipMute: (clipId, muted) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) clip.muted = muted
      })
    },

    setClipName: (clipId, name) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) clip.name = name
      })
    },

    setClipFade: (clipId, fadeInMs, fadeOutMs) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.fadeInMs = Math.max(0, fadeInMs)
          clip.fadeOutMs = Math.max(0, fadeOutMs)
        }
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
        if (!track.sourceDurationMs) track.sourceDurationMs = track.durationMs
        state.audioTracks.push(track)
        // Auto-create audio Track entry
        const idx = track.trackIndex
        if (!state.tracks.some((t) => t.kind === 'audio' && t.index === idx)) {
          state.tracks.push({
            id: `track_audio_${idx}`, index: idx, name: track.name ?? `Audio ${idx + 1}`,
            kind: 'audio', muted: false, locked: false, hidden: false, solo: false
          })
        }
        // O(1) grow: adding audio track
        growTotalDuration(state, track.startMs + track.durationMs)
      })
    },

    addMediaBatch: (clips, audioTracks) => {
      if (clips.length === 0 && audioTracks.length === 0) return
      pushUndoSnapshot()
      set((state) => {
        for (const clip of clips) {
          if (!clip.sourceDurationMs) clip.sourceDurationMs = clip.durationMs
          if (!clip.transform) clip.transform = { ...DEFAULT_TRANSFORM }
          if (!clip.speed) clip.speed = 1.0
          if (clip.volume === undefined) clip.volume = 1.0
          if (clip.muted === undefined) clip.muted = false
          if (clip.fadeInMs === undefined) clip.fadeInMs = 0
          if (clip.fadeOutMs === undefined) clip.fadeOutMs = 0
          state.clips.push(clip)
          const exists = state.tracks.some((t) => t.kind === 'video' && t.index === clip.trackIndex)
          if (!exists) {
            state.tracks.push({
              id: `track_v${clip.trackIndex}`, index: clip.trackIndex,
              name: `Video ${clip.trackIndex + 1}`, kind: 'video',
              muted: false, locked: false, hidden: false, solo: false
            })
          }
        }
        for (const track of audioTracks) {
          if (track.trimStart === undefined) track.trimStart = 0
          if (track.trimEnd === undefined) track.trimEnd = 0
          if (track.trackIndex === undefined) track.trackIndex = 0
          if (track.fadeInMs === undefined) track.fadeInMs = 0
          if (track.fadeOutMs === undefined) track.fadeOutMs = 0
          if (!track.sourceDurationMs) track.sourceDurationMs = track.durationMs
          state.audioTracks.push(track)
          const idx = track.trackIndex
          if (!state.tracks.some((t) => t.kind === 'audio' && t.index === idx)) {
            state.tracks.push({
              id: `track_audio_${idx}`, index: idx, name: track.name ?? `Audio ${idx + 1}`,
              kind: 'audio', muted: false, locked: false, hidden: false, solo: false
            })
          }
        }
        // O(1) grow: batch add only extends timeline
        let batchMax = state.totalDurationMs
        for (const c of clips) batchMax = Math.max(batchMax, c.startMs + c.durationMs)
        for (const a of audioTracks) batchMax = Math.max(batchMax, a.startMs + a.durationMs)
        state.totalDurationMs = batchMax
      })
    },

    removeAudioTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        state.audioTracks = state.audioTracks.filter((t) => t.id !== trackId)
        state.selectedIds = state.selectedIds.filter((id) => id !== trackId)
        if (state.focusedId === trackId) state.focusedId = null
        syncTotalDuration(state)
      })
    },

    trimAudioTrack: (trackId, trimStart, trimEnd) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) {
          track.trimStart = trimStart
          track.trimEnd = trimEnd
          track.durationMs = Math.max(100, track.sourceDurationMs - trimStart - trimEnd)
          syncTotalDuration(state)
        }
      })
    },

    moveAudioTrack: (trackId, startMs, trackIndex) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) {
          track.startMs = Math.max(0, startMs)
          if (trackIndex !== undefined) track.trackIndex = Math.max(0, Math.floor(trackIndex))
          syncTotalDuration(state)
        }
      })
    },

    setAudioVolume: (trackId, volume) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) track.volume = Math.max(0, Math.min(2.0, volume))
      })
    },

    toggleAudioMute: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) track.muted = !track.muted
      })
    },

    setAudioFade: (trackId, fadeInMs, fadeOutMs) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) {
          track.fadeInMs = Math.max(0, fadeInMs)
          track.fadeOutMs = Math.max(0, fadeOutMs)
        }
      })
    },

    // -- Text Clips --

    addTextClip: (clip) => {
      pushUndoSnapshot()
      set((state) => {
        const full = normalizeTextClip({ ...clip })
        // Canonical shape from birth (see addClip): fades explicit, never
        // undefined, so save→load round-trips identically.
        if (full.fadeInMs === undefined) full.fadeInMs = 0
        if (full.fadeOutMs === undefined) full.fadeOutMs = 0
        state.textClips.push(full)
        ensureCaptionTrackRecords(state)
        syncTotalDuration(state)
      })
    },

    addTextClips: (clips) => {
      if (clips.length === 0) return
      pushUndoSnapshot()
      set((state) => {
        for (const clip of clips) {
          const full = normalizeTextClip({ ...clip })
          if (full.fadeInMs === undefined) full.fadeInMs = 0
          if (full.fadeOutMs === undefined) full.fadeOutMs = 0
          state.textClips.push(full)
        }
        ensureCaptionTrackRecords(state)
        syncTotalDuration(state)
      })
    },

    updateTextClip: (id, updates) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.textClips.find((c) => c.id === id)
        if (!clip) return
        // Apply non-timing fields directly (text, style, words, trackIndex, etc.)
        const { startMs, durationMs, endMs, ...nonTiming } = updates
        Object.assign(clip, nonTiming)
        // Apply timing fields through the invariant-preserving function
        if (startMs !== undefined || durationMs !== undefined || endMs !== undefined) {
          applyTextClipMutations(clip, { startMs, durationMs, endMs })
        } else {
          normalizeTextClip(clip)
        }
        syncTotalDuration(state)
      })
    },

    updateTextClipLive: (id, updates) => {
      set((state) => {
        const clip = state.textClips.find((c) => c.id === id)
        if (!clip) return
        // Apply non-timing fields directly (text, style, words, trackIndex, etc.)
        const { startMs, durationMs, endMs, ...nonTiming } = updates
        Object.assign(clip, nonTiming)
        // Apply timing fields through the invariant-preserving function
        if (startMs !== undefined || durationMs !== undefined || endMs !== undefined) {
          applyTextClipMutations(clip, { startMs, durationMs, endMs })
        } else {
          normalizeTextClip(clip)
        }
        syncTotalDuration(state)
      })
    },

    deleteTextClip: (id) => {
      pushUndoSnapshot()
      set((state) => {
        state.textClips = state.textClips.filter((c) => c.id !== id)
        state.selectedIds = state.selectedIds.filter((tid) => tid !== id)
        if (state.focusedId === id) state.focusedId = null
        if (state.anchorId === id) state.anchorId = null
        syncTotalDuration(state)
      })
    },

    selectTextClip: (id) => {
      set((state) => {
        state.selectedIds = id ? [id] : []
        state.focusedId = id
        state.anchorId = id
      })
    },

    setTextFade: (id, fadeInMs, fadeOutMs) => {
      pushUndoSnapshot()
      set((state) => {
        const tc = state.textClips.find((t) => t.id === id)
        if (tc) {
          tc.fadeInMs = Math.max(0, fadeInMs)
          tc.fadeOutMs = Math.max(0, fadeOutMs)
        }
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

        const first: TextClip = normalizeTextClip({
          id: `${clip.id}_a`, startMs: clip.startMs, durationMs: splitAtMs - clip.startMs, endMs: splitAtMs,
          trackIndex: clip.trackIndex, text: firstText, style: clip.style ? { ...clip.style } : undefined,
          words: firstWords, wordTimestampsSource: clip.wordTimestampsSource,
          sourceId: clip.sourceId, sourceType: clip.sourceType, transcriptionJobId: clip.transcriptionJobId,
          originalWords: hasOriginals ? origWords?.filter((w) => w.endMs <= relativeSplit) : undefined,
          originalStartMs: hasOriginals ? origStart : undefined,
          originalEndMs: hasOriginals ? Math.min(origEnd!, splitAtMs) : undefined
        })
        const second: TextClip = normalizeTextClip({
          id: `${clip.id}_b`, startMs: splitAtMs, durationMs: getTextClipEnd(clip) - splitAtMs, endMs: getTextClipEnd(clip),
          trackIndex: clip.trackIndex, text: secondText, style: clip.style ? { ...clip.style } : undefined,
          words: secondWords, wordTimestampsSource: clip.wordTimestampsSource,
          sourceId: clip.sourceId, sourceType: clip.sourceType, transcriptionJobId: clip.transcriptionJobId,
          originalWords: hasOriginals ? origWords?.filter((w) => w.endMs > relativeSplit).map((w) => ({ ...w, startMs: w.startMs - relativeSplit, endMs: w.endMs - relativeSplit })) : undefined,
          originalStartMs: hasOriginals ? Math.max(origStart!, splitAtMs) : undefined,
          originalEndMs: hasOriginals ? origEnd : undefined
        })
        state.textClips.splice(idx, 1, first, second)
        syncTotalDuration(state)
      })
    },

    // -- Track management --

    addTrack: (kind) => {
      pushUndoSnapshot()
      set((state) => {
        const existingOfKind = state.tracks.filter((t) => t.kind === kind)
        const maxIndex = existingOfKind.reduce((m, t) => Math.max(m, t.index), -1)
        const newIndex = maxIndex + 1
        const label = kind.charAt(0).toUpperCase() + kind.slice(1)
        state.tracks.push({
          id: `track_${kind}_${uuid().slice(0, 8)}`, index: newIndex,
          name: `${label} ${newIndex + 1}`, kind, muted: false, locked: false, hidden: false, solo: false
        })
      })
    },

    deleteTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (!track) return
        // P1.1 cascade (D4): deleting a lane deletes the clips on that lane
        // for ALL kinds — matches the confirm-dialog copy ("and all clips
        // on it"). Lane index is per-kind (see addTrack maxIndex+1).
        if (track.kind === 'video') {
          state.clips = state.clips.filter((c) => c.trackIndex !== track.index)
        } else if (track.kind === 'audio') {
          state.audioTracks = state.audioTracks.filter((c) => c.trackIndex !== track.index)
        } else if (track.kind === 'caption') {
          state.textClips = state.textClips.filter((c) => c.trackIndex !== track.index)
        }
        // 'overlay' kind has no clip entity (never created) — drop record only.
        state.tracks = state.tracks.filter((t) => t.id !== trackId)
        syncTotalDuration(state)
      })
    },

    renameTrack: (trackId, name) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) track.name = name
      })
    },

    toggleMuteTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) track.muted = !track.muted
      })
    },

    toggleLockTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) track.locked = !track.locked
      })
    },

    toggleHideTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) track.hidden = !track.hidden
      })
    },

    toggleSoloTrack: (trackId) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) track.solo = !track.solo
      })
    },

    moveTrack: (trackId, direction) => {
      // No-op guard BEFORE the undo push: moving past the edge or an
      // unknown id must not pollute the depth-20 undo stack.
      const live = useTimeline.getState()
      const liveTrack = live.tracks.find((t) => t.id === trackId)
      if (!liveTrack) return
      const liveSiblings = live.tracks
        .filter((t) => t.kind === liveTrack.kind)
        .sort((a, b) => a.index - b.index)
      const livePos = liveSiblings.findIndex((t) => t.id === trackId)
      const liveOther = direction === 'up' ? liveSiblings[livePos - 1] : liveSiblings[livePos + 1]
      if (!liveOther) return
      pushUndoSnapshot()
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (!track) return
        // Swap lane positions with the nearest sibling of the same kind.
        // Clips on the two lanes move WITH their lane so the lane keeps
        // its content (headers + clips reorder together).
        const siblings = state.tracks
          .filter((t) => t.kind === track.kind)
          .sort((a, b) => a.index - b.index)
        const pos = siblings.findIndex((t) => t.id === trackId)
        if (pos < 0) return
        const other = direction === 'up' ? siblings[pos - 1] : siblings[pos + 1]
        if (!other) return
        const a = track.index
        const b = other.index
        track.index = b
        other.index = a
        if (track.kind === 'video') {
          for (const c of state.clips) {
            if (c.trackIndex === a) c.trackIndex = b
            else if (c.trackIndex === b) c.trackIndex = a
          }
        } else if (track.kind === 'audio') {
          for (const c of state.audioTracks) {
            if (c.trackIndex === a) c.trackIndex = b
            else if (c.trackIndex === b) c.trackIndex = a
          }
        } else if (track.kind === 'caption') {
          for (const c of state.textClips) {
            if (c.trackIndex === a) c.trackIndex = b
            else if (c.trackIndex === b) c.trackIndex = a
          }
        }
        syncTotalDuration(state)
      })
    },

    // -- Markers --
    addMarker: (marker) => {
      pushUndoSnapshot()
      set((state) => { state.markers.push({ ...marker, id: `marker_${Date.now()}` }) })
    },
    removeMarker: (markerId) => {
      pushUndoSnapshot()
      set((state) => { state.markers = state.markers.filter((m) => m.id !== markerId) })
    },
    clearMarkers: () => {
      pushUndoSnapshot()
      set((state) => { state.markers = [] })
    },

    // -- Playback --
    setPlayhead: (ms) => set((state) => { state.playheadMs = Math.max(0, ms) }),
    setZoom: (zoom) => set((state) => { state.zoom = Math.max(0.02, Math.min(10, zoom)) }),
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
      // Shared references (same safety argument as pushUndoSnapshot): the
      // drag interaction mutates only via set() producers, so the captured
      // refs stay pristine until commitDrag pushes them as the undo entry.
      const { clips, audioTracks, textClips, tracks, markers } = useTimeline.getState()
      _dragPreClips = clips
      _dragPreAudioTracks = audioTracks
      _dragPreTextClips = textClips
      _dragPreTracks = tracks
      _dragPreMarkers = markers
    },

    commitDrag: () => {
      if (!_dragPreClips) return
      const snapshot = {
        clips: _dragPreClips, audioTracks: _dragPreAudioTracks!, textClips: _dragPreTextClips!,
        captions: _dragPreTextClips!.map((tc) => ({
          id: tc.id, startMs: tc.startMs, endMs: getTextClipEnd(tc), text: tc.text
        })),
        tracks: _dragPreTracks ?? undefined,
        markers: _dragPreMarkers ?? undefined
      }
      freezeUndoSnapshot(snapshot)
      useProject.getState().pushUndo(snapshot)
      _dragPreClips = null; _dragPreAudioTracks = null; _dragPreTextClips = null
      _dragPreTracks = null; _dragPreMarkers = null
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
        syncTotalDuration(state)
      })
    },

    clearTimeline: () => {
      _clipboard = null; _inPointMs = null; _outPointMs = null
      clearWaveformCache()
      // Reset undo/redo stacks to prevent cross-project corruption
      useProject.setState({ undoStack: [], redoStack: [] })
      set(() => ({ ...initialState, tracks: makeDefaultTracks() }))
    },

    loadTimeline: (data) => {
      // Reset undo/redo stacks to prevent cross-project corruption
      useProject.setState({ undoStack: [], redoStack: [] })
      set((state) => {
        // Forward-compatible migration: ensure volume/muted/speed defaults
        // for .ecp files saved before these fields existed.
        state.clips = (data.clips || []).map((c) => ({
          ...c,
          volume: c.volume ?? 1,
          muted: c.muted ?? false,
          hasAudio: c.hasAudio ?? true,
          speed: c.speed ?? 1,
          fadeInMs: c.fadeInMs ?? 0,
          fadeOutMs: c.fadeOutMs ?? 0
        }))
        state.audioTracks = (data.audioTracks || []).map((t) => ({
          ...t,
          fadeInMs: t.fadeInMs ?? 0,
          fadeOutMs: t.fadeOutMs ?? 0,
          sourceDurationMs: t.sourceDurationMs ?? t.durationMs
        }))
        state.textClips = (data.textClips || []).map((tc) => normalizeTextClip({
          ...tc,
          fadeInMs: tc.fadeInMs ?? 0,
          fadeOutMs: tc.fadeOutMs ?? 0
        }))
        // Restore track lane state if present (new projects); fallback to defaults
        if (data.tracks && data.tracks.length > 0) {
          state.tracks = data.tracks
        }
        // P2.5: backfill caption lane records for used lanes (old files gain
        // exactly one `track_caption_0`; placement/styles/timing untouched).
        ensureCaptionTrackRecords(state)
        // Restore markers if present
        if (data.markers) {
          state.markers = data.markers
        }
        // Restore session state (playhead, zoom, volume, loop)
        if (data.playheadMs !== undefined) state.playheadMs = data.playheadMs
        if (data.zoom !== undefined) state.zoom = data.zoom
        if (data.masterVolume !== undefined) state.masterVolume = data.masterVolume
        if (data.loopEnabled !== undefined) state.loopEnabled = data.loopEnabled
        syncTotalDuration(state)
      })
    },

    recalcTotalDuration: () => set((state) => { syncTotalDuration(state) }),

    // ---------------------------------------------------------------------------
    // Keyframe actions
    // ---------------------------------------------------------------------------

    setClipKeyframes: (clipId, keyframes) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) clip.keyframes = keyframes
      })
    },

    removeClipKeyframeTrack: (clipId, property) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip?.keyframes) {
          clip.keyframes = clip.keyframes.filter((t) => t.property !== property)
          if (clip.keyframes.length === 0) clip.keyframes = undefined
        }
      })
    },

    addKeyframeAtPlayhead: (entityId, property, value) => {
      pushUndoSnapshot()
      set((state) => {
        const playhead = state.playheadMs
        // Try clip first
        const clip = state.clips.find((c) => c.id === entityId)
        if (clip) {
          const localMs = playhead - clip.startMs
          if (!clip.keyframes) clip.keyframes = []
          let track = clip.keyframes.find((t) => t.property === property)
          if (!track) {
            track = { property, frames: [] }
            clip.keyframes.push(track)
          }
          // Replace existing frame at same time or insert sorted
          const existing = track.frames.findIndex((f) => f.time === localMs)
          if (existing >= 0) {
            track.frames[existing].value = value
          } else {
            track.frames.push({ time: localMs, value, easing: 'linear' })
            track.frames.sort((a, b) => a.time - b.time)
          }
          return
        }
        // Try text clip
        const tc = state.textClips.find((t) => t.id === entityId)
        if (tc) {
          const localMs = playhead - tc.startMs
          if (!tc.keyframes) tc.keyframes = []
          let track = tc.keyframes.find((t) => t.property === property)
          if (!track) {
            track = { property, frames: [] }
            tc.keyframes.push(track)
          }
          const existing = track.frames.findIndex((f) => f.time === localMs)
          if (existing >= 0) {
            track.frames[existing].value = value
          } else {
            track.frames.push({ time: localMs, value, easing: 'linear' })
            track.frames.sort((a, b) => a.time - b.time)
          }
          return
        }
        // Try audio track
        const at = state.audioTracks.find((a) => a.id === entityId)
        if (at) {
          const localMs = playhead - at.startMs
          if (!at.keyframes) at.keyframes = []
          let track = at.keyframes.find((t) => t.property === property)
          if (!track) {
            track = { property, frames: [] }
            at.keyframes.push(track)
          }
          const existing = track.frames.findIndex((f) => f.time === localMs)
          if (existing >= 0) {
            track.frames[existing].value = value
          } else {
            track.frames.push({ time: localMs, value, easing: 'linear' })
            track.frames.sort((a, b) => a.time - b.time)
          }
        }
      })
    },

    setAudioKeyframes: (trackId, keyframes) => {
      pushUndoSnapshot()
      set((state) => {
        const track = state.audioTracks.find((t) => t.id === trackId)
        if (track) track.keyframes = keyframes
      })
    },

    setTextClipKeyframes: (textClipId, keyframes) => {
      pushUndoSnapshot()
      set((state) => {
        const tc = state.textClips.find((t) => t.id === textClipId)
        if (tc) tc.keyframes = keyframes
      })
    },

    // ---------------------------------------------------------------------------
    // Modifier actions (effects/filters)
    // ---------------------------------------------------------------------------

    addClipModifier: (clipId, modifier) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          if (!clip.modifiers) clip.modifiers = []
          clip.modifiers.push(modifier)
        }
      })
    },

    removeClipModifier: (clipId, modifierId) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip?.modifiers) {
          clip.modifiers = clip.modifiers.filter((m) => m.id !== modifierId)
          if (clip.modifiers.length === 0) clip.modifiers = undefined
        }
      })
    },

    updateClipModifier: (clipId, modifierId, patch) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        const mod = clip?.modifiers?.find((m) => m.id === modifierId)
        if (mod) {
          if (patch.enabled !== undefined) mod.enabled = patch.enabled
          if (patch.parameters) mod.parameters = { ...mod.parameters, ...patch.parameters }
          if (patch.keyframes) mod.keyframes = patch.keyframes
        }
      })
    },

    reorderClipModifier: (clipId, fromIndex, toIndex) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip?.modifiers && fromIndex >= 0 && toIndex >= 0 && toIndex < clip.modifiers.length) {
          const [moved] = clip.modifiers.splice(fromIndex, 1)
          clip.modifiers.splice(toIndex, 0, moved)
        }
      })
    },

    // ---------------------------------------------------------------------------
    // Transition actions
    // ---------------------------------------------------------------------------

    setClipOutTransition: (clipId, transition) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) {
          if (transition) {
            clip.outTransition = transition
          } else {
            clip.outTransition = undefined
          }
        }
      })
    },

    // ---------------------------------------------------------------------------
    // Blend mode
    // ---------------------------------------------------------------------------

    setClipBlendMode: (clipId, mode) => {
      pushUndoSnapshot()
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) clip.blendMode = mode
      })
    },

    // No undo snapshot — this is a background async operation
    setClipProxyPath: (clipId, proxyPath) => {
      set((state) => {
        const clip = state.clips.find((c) => c.id === clipId)
        if (clip) clip.proxyPath = proxyPath
      })
    }
  }))
)
