/**
 * lanes.ts — multi-lane caption SSOT (Phase 2, P2.1).
 *
 * Single source of truth for caption lane placement, stacking, and
 * visibility, consumed by:
 * - useCaption (transcription/import lane resolvers + entry mapping)
 * - TextPanel (manual text lane)
 * - Timeline canvas + interaction.ts (per-lane rows, hit-test)
 * - Preview canvas + CaptionStrip (stacked co-render)
 * - ExportDialog + generateExportASS (per-lane burn-in, G6 parity)
 *
 * Placement rule (roadmap P2): the transcription source decides the lane.
 * Stacking rule: overlapping captions on different lanes co-render stacked;
 * lower lane index draws on top (canvas paint order + ASS layer).
 * Lane 0 output is byte-identical to the old single-lane path (parity).
 *
 * Pure module: no DOM, no Electron, no store imports — safe for node:test.
 * Structural minimal interfaces keep shared free of renderer store types.
 */

import type { CaptionStyle } from '../types/caption'

/** Minimal shape for anything with a caption lane assignment. */
export interface CaptionLaneItem {
  trackIndex: number
}

/** Minimal timed caption for active-range + export-order resolution. */
export interface TimedCaption extends CaptionLaneItem {
  id: string
  startMs: number
  endMs: number
}

/** Minimal track record for lane visibility (mute/solo/hide). */
export interface CaptionLaneTrack {
  kind: string
  index: number
  muted: boolean
  solo: boolean
  hidden: boolean
}

/** Vertical step between stacked caption lanes, in style y-percentage points. */
export const CAPTION_LANE_STACK_STEP_PCT = 12

/**
 * First lane index with no captions on it. Empty timeline → 0.
 * Used by transcribeTimeline/file, SRT import default, and manual text —
 * never silently 0 when occupied.
 */
export function firstFreeCaptionLane(clips: CaptionLaneItem[]): number {
  const used = new Set(clips.map((c) => c.trackIndex))
  let lane = 0
  while (used.has(lane)) lane++
  return lane
}

/** Sorted distinct caption lane indices in use. */
export function usedCaptionLanes(clips: CaptionLaneItem[]): number[] {
  return [...new Set(clips.map((c) => c.trackIndex))].sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Placement resolvers — one per transcription source (roadmap P2 rule table)
// ---------------------------------------------------------------------------

/** transcribeClip → the source clip's lane. */
export function laneForTranscribeClip(sourceClipTrackIndex: number): number {
  return Math.max(0, Math.floor(sourceClipTrackIndex))
}

/** transcribeTrack(i) → lane i. */
export function laneForTranscribeTrack(trackIndex: number): number {
  return Math.max(0, Math.floor(trackIndex))
}

/** transcribeTimeline / single-file → first free lane (or 0 when empty). */
export function laneForTimelineTranscription(clips: CaptionLaneItem[]): number {
  return firstFreeCaptionLane(clips)
}

/** SRT import → explicit lane, defaulting to first free. */
export function laneForSrtImport(clips: CaptionLaneItem[], explicitLane?: number): number {
  if (explicitLane !== undefined) return Math.max(0, Math.floor(explicitLane))
  return firstFreeCaptionLane(clips)
}

/** Manual text (TextPanel) → first free lane, never silently 0 when occupied. */
export function laneForManualText(clips: CaptionLaneItem[]): number {
  return firstFreeCaptionLane(clips)
}

// ---------------------------------------------------------------------------
// Entry mapping — replaces the three hardcoded trackIndex: 0 sites
// ---------------------------------------------------------------------------

export interface ParsedCaptionEntry {
  startMs: number
  endMs: number
  text: string
  words?: Array<{ word: string; startMs: number; endMs: number }>
  wordTimestampsSource?: 'whisper' | 'synthetic'
}

export interface MappedTextClip {
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
  fadeInMs: number
  fadeOutMs: number
}

/**
 * Map parsed/transcribed entries to timeline text clips on a resolved lane.
 * `idPrefix` keeps ids deterministic in tests; callers pass a timestamped
 * prefix (`text_${Date.now()}`) in production.
 */
export function mapEntriesToTextClips(
  entries: ParsedCaptionEntry[],
  opts: {
    trackIndex: number
    idPrefix: string
    sourceId?: string
    sourceType?: MappedTextClip['sourceType']
    style?: CaptionStyle
    transcriptionJobId?: string
  }
): MappedTextClip[] {
  return entries.map((entry, idx) => ({
    id: `${opts.idPrefix}_${idx}`,
    startMs: entry.startMs,
    durationMs: entry.endMs - entry.startMs,
    endMs: entry.endMs,
    trackIndex: opts.trackIndex,
    text: entry.text,
    style: opts.style ? { ...opts.style } : undefined,
    words: entry.words?.map((w) => ({ ...w })),
    wordTimestampsSource: entry.wordTimestampsSource,
    sourceId: opts.sourceId,
    sourceType: opts.sourceType,
    transcriptionJobId: opts.transcriptionJobId,
    fadeInMs: 0,
    fadeOutMs: 0,
  }))
}

// ---------------------------------------------------------------------------
// Stacking — preview co-render + export burn-in share these (G6 parity)
// ---------------------------------------------------------------------------

/**
 * All captions active at `ms`, sorted by (lane asc, startMs asc, id).
 * Deterministic order; paint/export consumers draw in REVERSE so the lower
 * lane index ends up on top (documented z rule).
 */
export function resolveActiveCaptions<T extends TimedCaption>(clips: T[], ms: number): T[] {
  return clips
    .filter((c) => ms >= c.startMs && ms < c.endMs)
    .sort((a, b) =>
      a.trackIndex - b.trackIndex ||
      a.startMs - b.startMs ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
}

/**
 * Stacked position override for a caption on `laneIndex`.
 * Lane 0 returns the style's own x/y untouched (single-caption parity).
 * Deeper lanes step away from the anchor edge: bottom-anchored stacks
 * upward, top-anchored stacks downward, center stacks upward. Clamped to
 * keep text on canvas.
 */
export function captionLanePosition(
  style: Pick<CaptionStyle, 'x' | 'y' | 'position'>,
  laneIndex: number
): { x: number; y: number } {
  if (laneIndex <= 0) return { x: style.x, y: style.y }
  const step = CAPTION_LANE_STACK_STEP_PCT * laneIndex
  if ((style.position ?? 'bottom') === 'top') {
    return { x: style.x, y: Math.min(92, style.y + step) }
  }
  return { x: style.x, y: Math.max(8, style.y - step) }
}

/**
 * ASS layer for a caption lane so burned stacking matches preview:
 * lower lane index → higher layer → drawn on top. `maxLane` is the
 * highest lane index present in the export.
 */
export function captionAssLayer(laneIndex: number, maxLane: number): number {
  return Math.max(0, maxLane - laneIndex)
}

// ---------------------------------------------------------------------------
// Visibility — lane mute/solo/hide (V2.2), scoped to caption tracks only
// ---------------------------------------------------------------------------

/**
 * A caption lane renders/burns unless its Track record hides it:
 * hidden, muted (audio-parity affordance in the header), or excluded by
 * another caption lane's solo. Missing record → visible (old-file default).
 */
export function isCaptionLaneVisible(trackIndex: number, tracks: CaptionLaneTrack[]): boolean {
  const parent = tracks.find((t) => t.kind === 'caption' && t.index === trackIndex)
  if (!parent) return true
  if (parent.hidden || parent.muted) return false
  const captionTracks = tracks.filter((t) => t.kind === 'caption')
  const hasSolo = captionTracks.some((t) => t.solo)
  if (hasSolo && !parent.solo) return false
  return true
}

/** Captions on visible lanes only — shared by Preview and export mapping. */
export function visibleCaptionClips<T extends TimedCaption>(
  clips: T[],
  tracks: CaptionLaneTrack[]
): T[] {
  return clips.filter((c) => isCaptionLaneVisible(c.trackIndex, tracks))
}

/**
 * Deterministic export order: time order, lanes merged (roadmap P2.4 —
 * the SRT sidecar merges lanes in time order; ASS entries follow suit).
 * Non-mutating.
 */
export function sortCaptionsForExport<T extends TimedCaption>(clips: T[]): T[] {
  return [...clips].sort((a, b) =>
    a.startMs - b.startMs ||
    a.trackIndex - b.trackIndex ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}
