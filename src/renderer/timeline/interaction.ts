// ---------------------------------------------------------------------------
// CapCraft Timeline Interaction Engine
// Phases 1, 2, 3, 7: State Machine · Hit Testing · Box Select · Snap
// ---------------------------------------------------------------------------

import type { Clip, AudioTrack, TextClip, Track } from '../store/useTimeline'

// ========================== Phase 1: State Machine ==========================

export type InteractionMode =
  | 'idle'
  | 'dragging'
  | 'trimming-left'
  | 'trimming-right'
  | 'box-selecting'
  | 'scrubbing'
  | 'hand-scrolling'

export interface IdleMode { mode: 'idle' }

export interface DraggingMode {
  mode: 'dragging'
  clipIds: string[]
  startClientX: number
  startClientY: number
  originPositions: Map<string, { startMs: number; trackIndex: number }>
  isAudio: boolean
  /** Current snap target during drag (null = no snap). Drawn as visual indicator. */
  snappedTo: SnapEdge | null
}

export interface TrimmingMode {
  mode: 'trimming-left' | 'trimming-right'
  clipId: string
  clipKind: 'clip' | 'text' | 'audio'
  startClientX: number
  /** Source trim in-point (clipKind='clip' only) */
  origTrimStart: number
  /** Source trim out-point (clipKind='clip' only) */
  origTrimEnd: number
  sourceDurationMs: number
  /** Timeline-absolute start (clipKind='audio' edge drag only) */
  origTimelineStartMs?: number
  /** Timeline-absolute end (clipKind='audio' edge drag only) */
  origTimelineEndMs?: number
  // For text clips: preserve original startMs/endMs for non-destructive trim
  origStartMs?: number
  origEndMs?: number
  origWords?: Array<{ word: string; startMs: number; endMs: number }>
}

export interface BoxSelectingMode {
  mode: 'box-selecting'
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
}

export interface ScrubbingMode {
  mode: 'scrubbing'
}

export interface HandScrollingMode {
  mode: 'hand-scrolling'
  startClientX: number
  startScrollLeft: number
}

export type ModeState =
  | IdleMode
  | DraggingMode
  | TrimmingMode
  | BoxSelectingMode
  | ScrubbingMode
  | HandScrollingMode

type ModeCleanup = () => void

/**
 * Strict finite state machine for timeline interactions.
 * - Only one active mode at a time
 * - All transitions are explicit
 * - All event listeners are automatically cleaned up via AbortController
 * - Escape/blur/unmount always abort to idle
 */
export class InteractionMachine {
  state: ModeState = { mode: 'idle' }
  private abort: AbortController | null = null
  private cleanupFn: ModeCleanup | null = null

  get mode(): InteractionMode {
    return this.state.mode
  }

  get isIdle(): boolean {
    return this.state.mode === 'idle'
  }

  /** Signal for attaching listeners — valid only during current mode */
  get signal(): AbortSignal | null {
    return this.abort?.signal ?? null
  }

  /**
   * Transition to a new mode. Aborts the current mode first.
   * @param newState The new mode state
   * @param setup Called with the AbortSignal; attach listeners using { signal }
   * @param cleanup Called when this mode is exited (before next mode setup)
   */
  transition(
    newState: Exclude<ModeState, IdleMode>,
    setup: (signal: AbortSignal) => void,
    cleanup?: ModeCleanup
  ): void {
    this.exit()
    this.state = newState
    this.abort = new AbortController()
    this.cleanupFn = cleanup ?? null
    setup(this.abort.signal)
  }

  /** Return to idle, cleaning up all listeners and the mode cleanup fn */
  exit(): void {
    this.abort?.abort()
    this.abort = null
    this.cleanupFn?.()
    this.cleanupFn = null
    this.state = { mode: 'idle' }
  }

  /** Get the current mode with type narrowing */
  as<T extends ModeState['mode']>(mode: T): Extract<ModeState, { mode: T }> | null {
    if (this.state.mode === mode) {
      return this.state as Extract<ModeState, { mode: T }>
    }
    return null
  }

  /** Get current trim state (left or right) if active */
  getTrim(): TrimmingMode | null {
    if (this.state.mode === 'trimming-left' || this.state.mode === 'trimming-right') {
      return this.state as TrimmingMode
    }
    return null
  }
}

// ========================== Phase 2: Hit Testing ==========================

export type HitTarget =
  | { kind: 'clip-body'; id: string; trackIndex: number }
  | { kind: 'clip-left-handle'; id: string; trackIndex: number }
  | { kind: 'clip-right-handle'; id: string; trackIndex: number }
  | { kind: 'clip-fade-in'; id: string; trackIndex: number }
  | { kind: 'clip-fade-out'; id: string; trackIndex: number }
  | { kind: 'caption-body'; id: string }
  | { kind: 'caption-left-handle'; id: string }
  | { kind: 'caption-right-handle'; id: string }
  | { kind: 'caption-fade-in'; id: string }
  | { kind: 'caption-fade-out'; id: string }
  | { kind: 'audio-body'; id: string }
  | { kind: 'audio-left-handle'; id: string }
  | { kind: 'audio-right-handle'; id: string }
  | { kind: 'audio-fade-in'; id: string }
  | { kind: 'audio-fade-out'; id: string }
  | { kind: 'playhead' }
  | { kind: 'ruler' }
  | { kind: 'empty' }

/** Layout constants — must match Timeline component */
const TRACK_LANE_H = 36
const LANE_GAP = 4
const LANE_LABEL_W = 128
const RULER_H = 24
/** Minimum handle width in px — ensures short clips remain movable */
const MIN_HANDLE_PX = 6
/** Handle width as fraction of clip width — scales with zoom */
const HANDLE_FRACTION = 0.12
/** Maximum handle width in px */
const MAX_HANDLE_PX = 14
/** Playhead scrub zone in px */
const PLAYHEAD_ZONE_PX = 10
/** Minimum fade handle hit zone in px — ensures thin fades remain grabbable */
const FADE_HANDLE_HIT_PX = 8

/** Compute adaptive handle width based on clip pixel width */
export function getHandleWidth(clipWidthPx: number): number {
  return Math.max(MIN_HANDLE_PX, Math.min(MAX_HANDLE_PX, clipWidthPx * HANDLE_FRACTION))
}

interface LaneLayout {
  /** Y offset of lane relative to canvas top (includes RULER_H) */
  y: number
  trackKind: 'video' | 'audio' | 'caption'
  trackIndex: number
}

/** Build lane layout from tracks and data */
export function buildLaneLayout(
  tracks: Track[],
  clips: Clip[],
  audioTracks: AudioTrack[],
  captionEntries: TextClip[]
): LaneLayout[] {
  const lanes: LaneLayout[] = []

  // Video lanes
  const videoTrackCount = Math.max(
    1,
    ...tracks.filter((t) => t.kind === 'video').map((t) => t.index + 1),
    ...clips.map((c) => c.trackIndex + 1)
  )
  for (let i = 0; i < videoTrackCount; i++) {
    lanes.push({
      y: RULER_H + lanes.length * (TRACK_LANE_H + LANE_GAP),
      trackKind: 'video',
      trackIndex: i
    })
  }

  // Audio lanes — counted by max trackIndex (+1) across all audio tracks
  // and explicit audio Track entries, NOT the raw array length.
  // Multiple audio clips can share the same lane, like video clips do.
  const maxAudioIndex = audioTracks.reduce((m, t) => Math.max(m, t.trackIndex), 0)
  const audioLaneCount = Math.max(
    maxAudioIndex + 1,
    audioTracks.length > 0 ? 1 : 0,
    tracks.filter((t) => t.kind === 'audio').length
  )
  for (let i = 0; i < audioLaneCount; i++) {
    lanes.push({
      y: RULER_H + lanes.length * (TRACK_LANE_H + LANE_GAP),
      trackKind: 'audio',
      trackIndex: i
    })
  }

  // Caption lane
  if (captionEntries.length > 0) {
    lanes.push({
      y: RULER_H + lanes.length * (TRACK_LANE_H + LANE_GAP),
      trackKind: 'caption',
      trackIndex: 0
    })
  }

  return lanes
}

/** Total content height in px */
export function getTimelineHeight(laneCount: number): number {
  return RULER_H + laneCount * (TRACK_LANE_H + LANE_GAP)
}

/**
 * Deterministic hit test — returns exactly one HitTarget.
 *
 * Priority order (topmost first):
 * 1. Ruler (y < RULER_H)
 * 2. Playhead zone — highest priority over clips (rendered on top)
 * 3. Clip/caption/audio edges (handles) — topmost lane wins
 * 4. Clip/caption/audio body — topmost lane wins
 * 5. Empty space
 *
 * Reverse-iterates lanes so topmost visual element gets priority.
 */
export function hitTest(
  canvasX: number,        // x relative to canvas left (after subtracting LANE_LABEL_W)
  canvasY: number,        // y relative to canvas top
  ppm: number,            // pixels per ms
  playheadMs: number,
  lanes: LaneLayout[],
  clips: Clip[],
  audioTracks: AudioTrack[],
  captionEntries: TextClip[]
): HitTarget {
  const y = canvasY - RULER_H

  // Ruler
  if (canvasY < RULER_H) {
    return { kind: 'ruler' }
  }

  // Playhead zone — highest priority (rendered on top of clips)
  const playheadX = playheadMs * ppm
  if (Math.abs(canvasX - playheadX) < PLAYHEAD_ZONE_PX) {
    return { kind: 'playhead' }
  }

  // Reverse-iterate lanes: topmost visual lane gets hit priority
  for (let li = lanes.length - 1; li >= 0; li--) {
    const lane = lanes[li]
    if (y < lane.y - RULER_H || y > lane.y - RULER_H + TRACK_LANE_H) continue

    if (lane.trackKind === 'video') {
      // Reverse-iterate clips so topmost-drawn clip gets priority
      for (let ci = clips.length - 1; ci >= 0; ci--) {
        const clip = clips[ci]
        if (clip.trackIndex !== lane.trackIndex) continue
        const clipX = clip.startMs * ppm
        const clipW = Math.max(clip.durationMs * ppm, 4)
        if (canvasX < clipX || canvasX > clipX + clipW) continue

        // Fade handles take priority over trim handles when fade > 0
        const fadeInPx = (clip.fadeInMs ?? 0) * ppm
        if (fadeInPx > 0 && Math.abs(canvasX - (clipX + fadeInPx)) < Math.max(FADE_HANDLE_HIT_PX, fadeInPx * 0.3)) {
          return { kind: 'clip-fade-in', id: clip.id, trackIndex: clip.trackIndex }
        }
        const fadeOutPx = (clip.fadeOutMs ?? 0) * ppm
        if (fadeOutPx > 0 && Math.abs(canvasX - (clipX + clipW - fadeOutPx)) < Math.max(FADE_HANDLE_HIT_PX, fadeOutPx * 0.3)) {
          return { kind: 'clip-fade-out', id: clip.id, trackIndex: clip.trackIndex }
        }

        const hw = getHandleWidth(clipW)
        if (canvasX - clipX < hw) {
          return { kind: 'clip-left-handle', id: clip.id, trackIndex: clip.trackIndex }
        }
        if (clipX + clipW - canvasX < hw) {
          return { kind: 'clip-right-handle', id: clip.id, trackIndex: clip.trackIndex }
        }
        return { kind: 'clip-body', id: clip.id, trackIndex: clip.trackIndex }
      }
    }

    if (lane.trackKind === 'audio') {
      // Reverse-iterate audio tracks on this lane so topmost gets priority
      const laneTracks = audioTracks.filter((t) => t.trackIndex === lane.trackIndex)
      for (let ti = laneTracks.length - 1; ti >= 0; ti--) {
        const track = laneTracks[ti]
        const ax = track.startMs * ppm
        const aw = Math.max(track.durationMs * ppm, 40)
        if (canvasX < ax || canvasX > ax + aw) continue

        // Fade handles take priority over trim handles when fade > 0
        const fadeInPx = (track.fadeInMs ?? 0) * ppm
        if (fadeInPx > 0 && Math.abs(canvasX - (ax + fadeInPx)) < Math.max(FADE_HANDLE_HIT_PX, fadeInPx * 0.3)) {
          return { kind: 'audio-fade-in', id: track.id }
        }
        const fadeOutPx = (track.fadeOutMs ?? 0) * ppm
        if (fadeOutPx > 0 && Math.abs(canvasX - (ax + aw - fadeOutPx)) < Math.max(FADE_HANDLE_HIT_PX, fadeOutPx * 0.3)) {
          return { kind: 'audio-fade-out', id: track.id }
        }

        const hw = getHandleWidth(aw)
        if (canvasX - ax < hw) {
          return { kind: 'audio-left-handle', id: track.id }
        }
        if (ax + aw - canvasX < hw) {
          return { kind: 'audio-right-handle', id: track.id }
        }
        return { kind: 'audio-body', id: track.id }
      }
    }

    if (lane.trackKind === 'caption') {
      for (let ci = captionEntries.length - 1; ci >= 0; ci--) {
        const entry = captionEntries[ci]
        const ex = entry.startMs * ppm
        const ew = Math.max((entry.endMs - entry.startMs) * ppm, 4)
        if (canvasX < ex || canvasX > ex + ew) continue

        // Fade handles take priority over trim handles when fade > 0
        const fadeInPx = (entry.fadeInMs ?? 0) * ppm
        if (fadeInPx > 0 && Math.abs(canvasX - (ex + fadeInPx)) < Math.max(FADE_HANDLE_HIT_PX, fadeInPx * 0.3)) {
          return { kind: 'caption-fade-in', id: entry.id }
        }
        const fadeOutPx = (entry.fadeOutMs ?? 0) * ppm
        if (fadeOutPx > 0 && Math.abs(canvasX - (ex + ew - fadeOutPx)) < Math.max(FADE_HANDLE_HIT_PX, fadeOutPx * 0.3)) {
          return { kind: 'caption-fade-out', id: entry.id }
        }

        const hw = getHandleWidth(ew)
        if (canvasX - ex < hw) {
          return { kind: 'caption-left-handle', id: entry.id }
        }
        if (ex + ew - canvasX < hw) {
          return { kind: 'caption-right-handle', id: entry.id }
        }
        return { kind: 'caption-body', id: entry.id }
      }
    }
  }

  return { kind: 'empty' }
}

/**
 * Get cursor style for a hit target (used by onMouseMove hover).
 */
export function getCursorForHit(hit: HitTarget, activeTool: string): string {
  if (activeTool === 'hand') return 'grab'
  if (activeTool === 'blade') return 'crosshair'
  if (activeTool === 'zoom') return 'zoom-in'

  switch (hit.kind) {
    case 'clip-left-handle':
    case 'caption-left-handle':
    case 'audio-left-handle':
    case 'clip-fade-in':
    case 'caption-fade-in':
    case 'audio-fade-in':
      return 'w-resize'
    case 'clip-right-handle':
    case 'caption-right-handle':
    case 'audio-right-handle':
    case 'clip-fade-out':
    case 'caption-fade-out':
    case 'audio-fade-out':
      return 'e-resize'
    case 'clip-body':
    case 'caption-body':
    case 'audio-body':
      return 'grab'
    case 'playhead':
      return 'col-resize'
    case 'ruler':
      return 'crosshair'
    default:
      return ''
  }
}

// ========================== Phase 7: Snap Engine ==========================

export interface SnapEdge {
  timeMs: number
  sourceId: string
  kind: 'clip-start' | 'clip-end' | 'audio-start' | 'audio-end' |
        'caption-start' | 'caption-end' | 'playhead' | 'origin' | 'marker'
}

/** Pre-compute all snap edges from current timeline state */
export function computeSnapEdges(
  clips: Clip[],
  audioTracks: AudioTrack[],
  captionEntries: TextClip[],
  markers: Array<{ timeMs: number }>,
  playheadMs: number
): SnapEdge[] {
  const edges: SnapEdge[] = []

  // Origin
  edges.push({ timeMs: 0, sourceId: '__origin', kind: 'origin' })

  // Playhead
  edges.push({ timeMs: playheadMs, sourceId: '__playhead', kind: 'playhead' })

  // Clips
  for (const c of clips) {
    edges.push({ timeMs: c.startMs, sourceId: c.id, kind: 'clip-start' })
    edges.push({ timeMs: c.startMs + c.durationMs, sourceId: c.id, kind: 'clip-end' })
  }

  // Audio
  for (const a of audioTracks) {
    edges.push({ timeMs: a.startMs, sourceId: a.id, kind: 'audio-start' })
    edges.push({ timeMs: a.startMs + a.durationMs, sourceId: a.id, kind: 'audio-end' })
  }

  // Captions
  for (const tc of captionEntries) {
    edges.push({ timeMs: tc.startMs, sourceId: tc.id, kind: 'caption-start' })
    edges.push({ timeMs: tc.endMs, sourceId: tc.id, kind: 'caption-end' })
  }

  // Markers
  for (const m of markers) {
    edges.push({ timeMs: m.timeMs, sourceId: `marker_${m.timeMs}`, kind: 'marker' })
  }

  return edges
}

export interface SnapResult {
  snappedMs: number
  snappedTo: SnapEdge | null
}

/**
 * Snap a raw time position to the nearest edge within pixel threshold.
 * @param rawMs The raw time in ms
 * @param edges Pre-computed snap edges
 * @param excludeIds IDs to exclude (e.g., the clip being dragged)
 * @param ppm Current pixels-per-ms (for converting pixel threshold to ms)
 */
export function snapToEdges(
  rawMs: number,
  edges: SnapEdge[],
  excludeIds: Set<string>,
  ppm: number
): SnapResult {
  const SNAP_THRESHOLD_PX = 12
  const thresholdMs = SNAP_THRESHOLD_PX / ppm

  let bestMs = rawMs
  let bestDist = thresholdMs
  let bestEdge: SnapEdge | null = null

  for (const edge of edges) {
    if (excludeIds.has(edge.sourceId)) continue
    const dist = Math.abs(rawMs - edge.timeMs)
    if (dist < bestDist) {
      bestDist = dist
      bestMs = edge.timeMs
      bestEdge = edge
    }
  }

  return {
    snappedMs: Math.max(0, Math.round(bestMs)),
    snappedTo: bestEdge
  }
}

// ========================== Phase 3: Box Selection ==========================

export interface BoxRect {
  x1: number  // canvas-relative x (after LANE_LABEL_W)
  y1: number  // canvas-relative y (after RULER_H)
  x2: number
  y2: number
}

/** Compute box rect from two client positions, relative to canvas content area */
export function computeBoxRect(
  startClientX: number, startClientY: number,
  currentClientX: number, currentClientY: number,
  canvasRect: DOMRect
): BoxRect {
  const x1 = Math.min(startClientX, currentClientX) - canvasRect.left - LANE_LABEL_W
  const y1 = Math.min(startClientY, currentClientY) - canvasRect.top - RULER_H
  const x2 = Math.max(startClientX, currentClientX) - canvasRect.left - LANE_LABEL_W
  const y2 = Math.max(startClientY, currentClientY) - canvasRect.top - RULER_H
  return { x1, y1, x2, y2 }
}

/** Find all clip IDs whose timeline rect intersects the box */
export function findClipsInBox(
  box: BoxRect,
  ppm: number,
  lanes: LaneLayout[],
  clips: Clip[],
  audioTracks: AudioTrack[],
  captionEntries: TextClip[]
): string[] {
  const ids: string[] = []

  // Video clips
  for (const clip of clips) {
    const laneIdx = lanes.findIndex((l) => l.trackKind === 'video' && l.trackIndex === clip.trackIndex)
    if (laneIdx < 0) continue
    const lane = lanes[laneIdx]
    const cx = clip.startMs * ppm
    const cw = Math.max(clip.durationMs * ppm, 4)
    const cy = lane.y - RULER_H
    const ch = TRACK_LANE_H

    if (rectsOverlap(box.x1, box.y1, box.x2, box.y2, cx, cy, cx + cw, cy + ch)) {
      ids.push(clip.id)
    }
  }

  // Audio tracks — match by track.trackIndex, not array position
  for (const track of audioTracks) {
    const laneIdx = lanes.findIndex((l) => l.trackKind === 'audio' && l.trackIndex === track.trackIndex)
    if (laneIdx < 0) continue
    const lane = lanes[laneIdx]
    const ax = track.startMs * ppm
    const aw = Math.max(track.durationMs * ppm, 40)
    const ay = lane.y - RULER_H
    const ah = TRACK_LANE_H

    if (rectsOverlap(box.x1, box.y1, box.x2, box.y2, ax, ay, ax + aw, ay + ah)) {
      ids.push(track.id)
    }
  }

  // Caption entries
  const capLaneIdx = lanes.findIndex((l) => l.trackKind === 'caption')
  if (capLaneIdx >= 0) {
    const capLane = lanes[capLaneIdx]
    const cy = capLane.y - RULER_H
    const ch = TRACK_LANE_H
    for (const entry of captionEntries) {
      const ex = entry.startMs * ppm
      const ew = Math.max((entry.endMs - entry.startMs) * ppm, 4)
      if (rectsOverlap(box.x1, box.y1, box.x2, box.y2, ex, cy, ex + ew, cy + ch)) {
        ids.push(entry.id)
      }
    }
  }

  return ids
}

function rectsOverlap(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number
): boolean {
  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1
}

// ========================== Layout Constants (exported) ==========================

export const LAYOUT = {
  TRACK_LANE_H,
  LANE_GAP,
  LANE_LABEL_W,
  RULER_H,
  PLAYHEAD_ZONE_PX
} as const
