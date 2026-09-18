/**
 * exportGraph.ts — Shared export graph (Phase 7 SSOT, task.txt).
 *
 * Pure, zero-dependency. Importable from main, renderer, preload, and tests.
 * This module is the SINGLE SOURCE for "timeline state -> effects ->
 * modifiers -> keyframes -> audio -> FFmpeg":
 *
 *   Timeline state (clips, tracks, audio)
 *     -> visibility/mute resolution (same rules as Preview)
 *     -> per-clip video filters (transform is handled by FFmpegService;
 *        THIS module emits effect/modifier + keyframe-sampled filters)
 *     -> blend modes (-> ffmpeg `blend`, not `overlay`)
 *     -> out-transitions (-> resolved alpha fade windows)
 *     -> audio (volume automation, fades)
 *     -> FFmpegService.buildExportCommand (mechanical application)
 *
 * Preview parity contract (documented approximations, same ORDER and same
 * enable WINDOWS as Preview):
 * - Effect stack order is preserved: filters emit in modifier-stack order,
 *   exactly like FilterPipeline.buildCssFilter joins CSS fragments in order.
 * - CSS<->ffmpeg mappings are first-order equivalents (eq/hue/gblur/unsharp/
 *   negate/colorchannelmixer), NOT pixel-identical: two different render
 *   engines can never be bit-exact. What is guaranteed: the same effects are
 *   applied, in the same order, over the same time windows, with the same
 *   opacities and blend modes.
 * - Keyframed properties are baked as piecewise-constant segments gated by
 *   `enable='between(t,a,b)'` on the ABSOLUTE timeline. Segment count is
 *   capped (MAX_ANIMATED_SEGMENTS) to bound graph size; beyond the cap the
 *   track is sampled uniformly. Values are rounded to 4 decimals so graphs
 *   are deterministic across runs.
 * - Anything that cannot be represented (unknown effect id, partial invert,
 *   animated crop/blend, non-crossfade transition types) is REPORTED in
 *   `dropped`/`warnings` — never silently skipped.
 */

import type {
  CanonicalBlendMode,
  CanonicalKeyframeTrack,
  CanonicalModifier,
} from '../project/projectSchema'

// ---------------------------------------------------------------------------
// Easing (ported 1:1 from src/renderer/effects/utils/easing.ts)
// ---------------------------------------------------------------------------
// Duplicated (not imported) because tsconfig.node.json excludes
// src/renderer/** — even `import type` would poison the main-process build.
// Drift is caught by exportGraph.inttest.ts, which includes BOTH files and
// asserts numeric equality across easings x sample points.

export type ExportEasing =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeOutBack'
  | 'easeOutExpo'
  | 'easeOutElastic'
  | 'easeOutBounce'

function easeValue(easing: string, t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  switch (easing) {
    case 'linear':
      return clamped
    case 'easeIn':
      return clamped * clamped * clamped
    case 'easeOut':
      return 1 - Math.pow(1 - clamped, 3)
    case 'easeInOut':
      return clamped < 0.5
        ? 4 * clamped * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 3) / 2
    case 'easeOutBack': {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(clamped - 1, 3) + c1 * Math.pow(clamped - 1, 2)
    }
    case 'easeOutExpo':
      return clamped === 1 ? 1 : 1 - Math.pow(2, -10 * clamped)
    case 'easeOutElastic': {
      if (clamped === 0 || clamped === 1) return clamped
      const c4 = (2 * Math.PI) / 3
      return Math.pow(2, -10 * clamped) * Math.sin((clamped * 10 - 0.75) * c4) + 1
    }
    case 'easeOutBounce': {
      const n1 = 7.5625
      const d1 = 2.75
      if (clamped < 1 / d1) return n1 * clamped * clamped
      if (clamped < 2 / d1) {
        const a = clamped - 1.5 / d1
        return n1 * a * a + 0.75
      }
      if (clamped < 2.5 / d1) {
        const a = clamped - 2.25 / d1
        return n1 * a * a + 0.9375
      }
      const a = clamped - 2.625 / d1
      return n1 * a * a + 0.984375
    }
    default:
      return clamped
  }
}

/** Deterministic number formatting for filter graphs (4 decimals, no -0). */
export function fmtFilterNumber(value: number): string {
  const rounded = Number(value.toFixed(4))
  return `${rounded === 0 ? 0 : rounded}`
}

/**
 * Test hook: evaluate one easing curve. Exported (not kept private) so the
 * parity test can assert numeric equality with the renderer's applyEasing
 * across every curve x sample point.
 */
export function evaluateExportEasing(easing: string, t: number): number {
  return easeValue(easing, t)
}

/**
 * Evaluate a numeric keyframe track at clip-local time `tMs` (mirrors
 * KeyframeEvaluator.evaluateKeyframeTrack for the numeric path: hold first /
 * hold last / eased lerp between frames). Non-numeric frames fall back to
 * `fallback`. Frames are sorted defensively (validator does not guarantee
 * order; sorting a copy never mutates the caller's data).
 */
export function evaluateExportTrack(
  track: CanonicalKeyframeTrack,
  tMs: number,
  fallback: number
): number {
  const frames = track.frames
    .filter((f) => typeof f.value === 'number')
    .slice()
    .sort((a, b) => a.time - b.time)
  if (frames.length === 0) return fallback
  const first = frames[0]
  if (tMs <= first.time) return first.value as number
  const last = frames[frames.length - 1]
  if (tMs >= last.time) return last.value as number
  for (let i = 0; i < frames.length - 1; i++) {
    const from = frames[i]
    const to = frames[i + 1]
    if (tMs < to.time) {
      const span = to.time - from.time
      if (span <= 0) return from.value as number
      const eased = easeValue(from.easing, (tMs - from.time) / span)
      return (from.value as number) + ((to.value as number) - (from.value as number)) * eased
    }
  }
  return last.value as number
}

/** Cap on baked keyframe segments per animated property per clip. */
export const MAX_ANIMATED_SEGMENTS = 24

export interface ExportTimeSegment {
  startMs: number
  endMs: number
  value: number
}

/**
 * Bake a numeric track into piecewise-constant segments over [0, durationMs].
 * Boundaries fall on keyframe times (clamped); segments are evaluated at
 * midpoints through the eased curve. Caps segment count (uniform resample
 * beyond the cap). Adjacent segments with identical values are merged so
 * static tracks collapse to a single segment.
 */
export function sampleTrackSegments(
  track: CanonicalKeyframeTrack,
  durationMs: number,
  fallback: number,
  maxSegments: number = MAX_ANIMATED_SEGMENTS
): ExportTimeSegment[] {
  const dur = Math.max(0, durationMs)
  if (dur <= 0) return []
  const numericTimes = track.frames
    .filter((f) => typeof f.value === 'number')
    .map((f) => Math.max(0, Math.min(dur, f.time)))
  let boundaries = Array.from(new Set([0, ...numericTimes, dur])).sort((a, b) => a - b)
  if (boundaries.length - 1 > maxSegments) {
    boundaries = []
    for (let i = 0; i <= maxSegments; i++) boundaries.push((dur * i) / maxSegments)
  }
  const raw: ExportTimeSegment[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const s = boundaries[i]
    const e = boundaries[i + 1]
    if (e <= s) continue
    const value = Number(evaluateExportTrack(track, (s + e) / 2, fallback).toFixed(4))
    raw.push({ startMs: s, endMs: e, value })
  }
  // Merge adjacent equal-valued segments (static tracks -> 1 segment).
  const merged: ExportTimeSegment[] = []
  for (const seg of raw) {
    const prev = merged[merged.length - 1]
    if (prev && prev.value === seg.value && prev.endMs === seg.startMs) {
      prev.endMs = seg.endMs
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}

// ---------------------------------------------------------------------------
// Modifier -> ffmpeg filter mapping
// ---------------------------------------------------------------------------

export interface ExportAnimatedFilter {
  /** Complete filter fragment WITHOUT enable (caller appends the window). */
  filter: string
  /** Clip-LOCAL milliseconds (caller offsets to the absolute timeline). */
  startMs: number
  endMs: number
}

export interface ModifierFilterResult {
  staticFilters: string[]
  animatedFilters: ExportAnimatedFilter[]
  dropped: string[]
}

function numericParam(
  parameters: Record<string, number | string | boolean>,
  name: string
): number | null {
  const v = parameters[name]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function findParamTrack(
  keyframes: CanonicalKeyframeTrack[] | undefined,
  paramName: string
): CanonicalKeyframeTrack | null {
  if (!keyframes) return null
  const track = keyframes.find((t) => t.property === paramName)
  if (!track || track.frames.length === 0) return null
  if (!track.frames.some((f) => typeof f.value === 'number')) return null
  return track
}

/** Build one static filter string for (presetId, numeric value). Null = identity/drop. */
function staticFilterFor(presetId: string, value: number): string | null {
  switch (presetId) {
    case 'blur': {
      if (value <= 0) return null
      return `gblur=sigma=${fmtFilterNumber(Math.max(0.1, value / 2))}`
    }
    case 'brightness':
    case 'exposure': {
      // Preview maps brightness/exposure to CSS `brightness(1 + level/100)`,
      // which MULTIPLIES each channel. ffmpeg `eq=brightness` is an additive
      // luma offset (leaves chroma, so saturated colors don't match); scaling
      // RGB with colorchannelmixer is the exact CSS semantics.
      if (Math.abs(value) < 1e-9) return null
      const factor = 1 + value / 100
      return `colorchannelmixer=rr=${fmtFilterNumber(factor)}:gg=${fmtFilterNumber(factor)}:bb=${fmtFilterNumber(factor)}`
    }
    case 'contrast': {
      if (Math.abs(value) < 1e-9) return null
      return `eq=contrast=${fmtFilterNumber(1 + value / 100)}`
    }
    case 'saturation': {
      if (Math.abs(value) < 1e-9) return null
      return `eq=saturation=${fmtFilterNumber(1 + value / 100)}`
    }
    case 'hue-rotate': {
      if (Math.abs(value) < 1e-9) return null
      return `hue=h=${fmtFilterNumber(value)}`
    }
    case 'sepia': {
      if (value <= 0) return null
      // Sepia matrix M blended with identity I by amount a: a*M + (1-a)*I.
      const a = Math.max(0, Math.min(1, value / 100))
      const sepia = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131]
      const ident = [1, 0, 0, 0, 1, 0, 0, 0, 1]
      const m = sepia.map((s, i) => fmtFilterNumber(a * s + (1 - a) * ident[i]))
      return (
        `colorchannelmixer=rr=${m[0]}:rg=${m[1]}:rb=${m[2]}` +
        `:gr=${m[3]}:gg=${m[4]}:gb=${m[5]}:br=${m[6]}:bg=${m[7]}:bb=${m[8]}`
      )
    }
    case 'grayscale': {
      if (value <= 0) return null
      return `eq=saturation=${fmtFilterNumber(1 - Math.max(0, Math.min(1, value / 100)))}`
    }
    case 'invert': {
      // ffmpeg negate has no partial amount: >=50% maps to full negate,
      // below that is unrepresentable (reported, never silent).
      if (value >= 50) return 'negate'
      return null
    }
    case 'sharpen': {
      if (value <= 0) return null
      return `unsharp=5:5:${fmtFilterNumber(0.2 + (value / 100) * 1.5)}:5:5:0.0`
    }
    default:
      return null
  }
}

/**
 * Filters that do NOT accept timeline `enable` gating (verified against the
 * ffmpeg filter graph parser — `negate:enable='...'` is a hard parse error).
 * Animated tracks on these effects are unrepresentable when baked and are
 * reported as dropped; the STATIC form (no enable) still works.
 */
const NO_ENABLE_FILTERS = new Set(['negate'])

/** True when a value is the identity (no-op) for an effect — safe to skip silently. */
function isIdentityFilterValue(presetId: string, value: number): boolean {
  switch (presetId) {
    case 'blur':
    case 'sepia':
    case 'grayscale':
    case 'sharpen':
      return value <= 0
    case 'brightness':
    case 'exposure':
    case 'contrast':
    case 'saturation':
    case 'hue-rotate':
      return Math.abs(value) < 1e-9
    default:
      return false
  }
}

/** The single numeric parameter each known effect animates/filters on. */
function primaryParamName(presetId: string): string | null {
  switch (presetId) {
    case 'blur':
    case 'sepia':
    case 'grayscale':
    case 'invert':
    case 'sharpen':
      return 'amount'
    case 'brightness':
    case 'contrast':
    case 'saturation':
    case 'exposure':
      return 'level'
    case 'hue-rotate':
      return 'angle'
    default:
      return null
  }
}

/**
 * Convert a clip's modifier stack to ffmpeg filter fragments.
 * Order = stack order (matches Preview's CSS join order).
 */
export function modifiersToFfmpegFilters(
  modifiers: CanonicalModifier[] | undefined,
  clipLabel: string,
  clipDurationMs: number
): ModifierFilterResult {
  const staticFilters: string[] = []
  const animatedFilters: ExportAnimatedFilter[] = []
  const dropped: string[] = []
  if (!modifiers || modifiers.length === 0) {
    return { staticFilters, animatedFilters, dropped }
  }
  for (const mod of modifiers) {
    const label = `${clipLabel} modifier '${mod.presetId}'`
    if (!mod.enabled) {
      dropped.push(`${label}: disabled by user (not exported)`)
      continue
    }
    const paramName = primaryParamName(mod.presetId)
    if (paramName === null) {
      dropped.push(`${label}: unknown effect id (no ffmpeg mapping)`)
      continue
    }
    const track = findParamTrack(mod.keyframes, paramName)
    const staticValue = numericParam(mod.parameters, paramName)
    if (track) {
      // Animated: bake segments; a segment whose value is identity is still
      // emitted (enable windows must cover the range uniformly).
      const fallback = staticValue ?? 0
      // Probe the static form first: some filters (negate) reject `enable`
      // gating at parse time, so an animated track on them can never bake.
      const probe = staticFilterFor(mod.presetId, fallback === 0 ? 100 : fallback)
      if (probe !== null && NO_ENABLE_FILTERS.has(probe)) {
        dropped.push(
          `${label}: keyframed '${paramName}' cannot bake — '${probe}' rejects timeline gating (static value still exports)`
        )
        const staticFilter = staticValue !== null ? staticFilterFor(mod.presetId, staticValue) : null
        if (staticFilter !== null) staticFilters.push(staticFilter)
        continue
      }
      const segments = sampleTrackSegments(track, clipDurationMs, fallback)
      let emitted = 0
      for (const seg of segments) {
        // Identity segments are no-ops: skipping them leaves a gap in the
        // enable windows, which is exactly correct (no filter = identity).
        if (isIdentityFilterValue(mod.presetId, seg.value)) continue
        const filter = staticFilterFor(mod.presetId, seg.value)
        if (filter === null) {
          dropped.push(
            `${label}: keyframed value ${seg.value} at [${seg.startMs},${seg.endMs}]ms is unrepresentable`
          )
          continue
        }
        animatedFilters.push({ filter, startMs: seg.startMs, endMs: seg.endMs })
        emitted += 1
      }
      if (emitted === 0 && !segments.every((s) => isIdentityFilterValue(mod.presetId, s.value))) {
        dropped.push(`${label}: all keyframed values unrepresentable`)
      }
    } else if (staticValue === null) {
      dropped.push(`${label}: missing numeric '${paramName}' parameter`)
    } else {
      const filter = staticFilterFor(mod.presetId, staticValue)
      if (filter === null) {
        // Identity values are no-ops (not "dropped"); only genuinely
        // unrepresentable values (partial invert) are reported.
        if (mod.presetId === 'invert') {
          dropped.push(`${label}: partial invert (${staticValue}%) has no ffmpeg equivalent (needs >=50%)`)
        }
      } else {
        staticFilters.push(filter)
      }
    }
  }
  return { staticFilters, animatedFilters, dropped }
}

// ---------------------------------------------------------------------------
// Blend modes
// ---------------------------------------------------------------------------

/**
 * Map a timeline blendMode to an ffmpeg `blend` per-plane mode. Returns null
 * for 'normal' (plain `overlay` path). Applied as
 * `blend=c0_mode=X:c1_mode=X:c2_mode=X:c3_mode=normal:all_opacity=1` so RGB
 * blends while alpha follows the foreground (matches CSS mix-blend-mode
 * compositing over the accumulated frame).
 */
export function blendModeToFfmpeg(mode: string | undefined): string | null {
  switch (mode ?? 'normal') {
    case 'normal':
      return null
    case 'multiply':
      return 'multiply'
    case 'screen':
      return 'screen'
    case 'overlay':
      return 'overlay'
    case 'darken':
      return 'darken'
    case 'lighten':
      return 'lighten'
    case 'color-dodge':
      return 'addition'
    case 'color-burn':
      return 'burn'
    case 'soft-light':
      return 'softlight'
    case 'difference':
      return 'difference'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Visibility / mute resolution (mirrors useTimeline SSOT helpers)
// ---------------------------------------------------------------------------

export interface ExportLane {
  kind: string
  index: number
  muted: boolean
  hidden: boolean
  solo: boolean
}

export function resolveVideoHidden(
  trackIndex: number,
  lanes: ExportLane[]
): boolean {
  const video = lanes.filter((l) => l.kind === 'video')
  const parent = video.find((l) => l.index === trackIndex)
  const isHidden = parent?.hidden ?? false
  const hasSolo = video.some((l) => l.solo)
  const isSolo = parent?.solo ?? false
  return isHidden || (hasSolo && !isSolo)
}

export function resolveVideoMuted(
  clipMuted: boolean,
  trackIndex: number,
  lanes: ExportLane[]
): boolean {
  const video = lanes.filter((l) => l.kind === 'video')
  const parent = video.find((l) => l.index === trackIndex)
  const trackMuted = parent?.muted ?? false
  const hasSolo = video.some((l) => l.solo)
  const isSolo = parent?.solo ?? false
  return clipMuted || trackMuted || (hasSolo && !isSolo)
}

export function resolveAudioMuted(
  trackMuted: boolean,
  trackIndex: number,
  lanes: ExportLane[]
): boolean {
  const hasSolo = lanes.some((l) => l.solo)
  const parent = lanes.find((l) => l.kind === 'audio' && l.index === trackIndex)
  const laneMuted = parent?.muted ?? false
  const laneSolo = parent?.solo ?? false
  return trackMuted || laneMuted || (hasSolo && !laneSolo)
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export interface ExportClipTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  opacity: number
  cropTop: number
  cropBottom: number
  cropLeft: number
  cropRight: number
}

export interface ExportGraphClipInput {
  path: string
  startMs: number
  durationMs: number
  trimStart: number
  speed: number
  volume: number
  muted: boolean
  hasAudio?: boolean
  trackIndex: number
  transform: ExportClipTransform | null
  fadeInMs?: number
  fadeOutMs?: number
  keyframes?: CanonicalKeyframeTrack[]
  modifiers?: CanonicalModifier[]
  blendMode?: CanonicalBlendMode | string
  outTransition?: { type: string; durationMs: number }
}

export interface ExportGraphAudioInput {
  path: string
  startMs: number
  volume: number
  muted: boolean
  trimStart?: number
  durationMs?: number
  fadeInMs?: number
  fadeOutMs?: number
  trackIndex: number
  keyframes?: CanonicalKeyframeTrack[]
}

export interface ClipExportNode {
  index: number
  visible: boolean
  includeNativeAudio: boolean
  startMs: number
  durationMs: number
  trimStart: number
  speed: number
  volume: number
  edgeFadeInMs: number
  edgeFadeOutMs: number
  /** Resolved crossfade/dip windows (absolute-anchored by the caller). */
  transitionFadeInMs: number
  transitionFadeOutMs: number
  /** Geometric slide offsets for this clip (clip-local ms), if any. */
  slideOut: SlideGeometry | null
  slideIn: SlideGeometry | null
  /** Geometric zoom scales for this clip (clip-local ms), if any. */
  zoomOut: ZoomGeometry | null
  zoomIn: ZoomGeometry | null
  transform: ExportClipTransform | null
  staticFilters: string[]
  animatedFilters: ExportAnimatedFilter[]
  staticOpacity: number
  animatedOpacity: ExportTimeSegment[]
  animatedVolume: ExportTimeSegment[]
  /** ffmpeg blend mode name, or null for the normal `overlay` path. */
  blend: string | null
  dropped: string[]
}

/**
 * Animated overlay offset for a slide transition, expressed as a fraction of
 * the output dimension. x(t) = (fromFrac + (toFrac-fromFrac)*p) * dim, where
 * p is the linear progress across [startMs, endMs] (clip-local).
 */
export interface SlideGeometry {
  axis: 'x' | 'y'
  fromFrac: number
  toFrac: number
  startMs: number
  endMs: number
}

/**
 * Animated scale for a zoom transition. scale(t) interpolates fromScale ->
 * toScale across [startMs, endMs] (clip-local); 1 otherwise. Mirrors
 * Preview: zoom-in out 1->1.5 / in 1.5->1; zoom-out out 1->0.7 / in 0.7->1.
 */
export interface ZoomGeometry {
  fromScale: number
  toScale: number
  startMs: number
  endMs: number
}

export interface AudioExportNode {
  index: number
  audible: boolean
  startMs: number
  durationMs: number
  trimStart: number
  volume: number
  fadeInMs: number
  fadeOutMs: number
  animatedVolume: ExportTimeSegment[]
}

export interface ExportGraph {
  clips: ClipExportNode[]
  audioTracks: AudioExportNode[]
  warnings: string[]
  dropped: string[]
}

export interface BuildExportGraphInput {
  clips: ExportGraphClipInput[]
  audioTracks: ExportGraphAudioInput[]
  lanes: ExportLane[]
}

/**
 * Transition types representable as alpha fades. Preview renders
 * wipe-left/wipe-right as a plain opacity crossfade (index.tsx:1156-1158,
 * 1193-1195), so they belong here — no geometric mask is needed.
 */
const FADE_TRANSITIONS = new Set([
  'crossfade', 'dip-to-black', 'fade', 'wipe-left', 'wipe-right',
])

/**
 * Slide transitions → per-axis offset geometry. The OUTGOING clip animates
 * 0 -> ±1 (leaves the frame); the INCOMING clip animates ∓1 -> 0 (enters).
 * Applied by FFmpegService as animated overlay x/y expressions.
 */
const SLIDE_TRANSITIONS: Record<string, { axis: 'x' | 'y'; outTo: number }> = {
  'slide-left': { axis: 'x', outTo: -1 },
  'slide-right': { axis: 'x', outTo: 1 },
  'slide-up': { axis: 'y', outTo: -1 },
  'slide-down': { axis: 'y', outTo: 1 },
}

/**
 * Build the canonical export graph. Single source consumed by ExportDialog
 * (payload assembly) and covered by exportGraph.inttest.ts. FFmpegService
 * applies the nodes mechanically (absolute timeline offsets, overlay/blend
 * chain) — it performs NO visibility/mute/effect interpretation of its own.
 */
export function buildExportGraph(input: BuildExportGraphInput): ExportGraph {
  const warnings: string[] = []
  const dropped: string[] = []

  const clips: ClipExportNode[] = input.clips.map((clip, index) => {
    const label = `clip[${index}]`
    const visible = !resolveVideoHidden(clip.trackIndex, input.lanes)
    const videoMuted = resolveVideoMuted(clip.muted ?? false, clip.trackIndex, input.lanes)
    const includeNativeAudio =
      visible && !videoMuted && (clip.hasAudio ?? true) && (clip.volume ?? 1) !== 0

    const fx = modifiersToFfmpegFilters(clip.modifiers, label, clip.durationMs)
    dropped.push(...fx.dropped)

    // Clip-level keyframes: opacity (+ transform tracks, which FFmpegService
    // applies to scale/rotate/overlay-position; opacity is baked here).
    const opacityTrack = (clip.keyframes ?? []).find((t) => t.property === 'opacity')
    const baseOpacity = clip.transform?.opacity ?? 1
    const animatedOpacity: ExportTimeSegment[] = opacityTrack
      ? sampleTrackSegments(opacityTrack, clip.durationMs, baseOpacity * 100).map((s) => ({
        ...s,
        value: s.value / 100,
      }))
      : []
    const volumeTrack = (clip.keyframes ?? []).find(
      (t) => t.property === 'volume'
    )
    const animatedVolume: ExportTimeSegment[] = volumeTrack
      ? sampleTrackSegments(volumeTrack, clip.durationMs, clip.volume ?? 1)
      : []

    const blend = blendModeToFfmpeg(clip.blendMode)
    if (
      clip.blendMode !== undefined &&
      clip.blendMode !== 'normal' &&
      blend === null &&
      clip.trackIndex > 0
    ) {
      warnings.push(`${label}: unknown blendMode '${clip.blendMode}' exported as normal`)
    }

    return {
      index,
      visible,
      includeNativeAudio,
      startMs: clip.startMs,
      durationMs: clip.durationMs,
      trimStart: clip.trimStart,
      speed: clip.speed,
      volume: clip.volume ?? 1,
      edgeFadeInMs: clip.fadeInMs ?? 0,
      edgeFadeOutMs: clip.fadeOutMs ?? 0,
      transitionFadeInMs: 0,
      transitionFadeOutMs: 0,
      /** Geometric slide offsets for this clip (clip-local ms), if any. */
      slideOut: null,
      slideIn: null,
      /** Geometric zoom scales for this clip (clip-local ms), if any. */
      zoomOut: null,
      zoomIn: null,
      transform: clip.transform,
      staticFilters: fx.staticFilters,
      animatedFilters: fx.animatedFilters,
      staticOpacity: baseOpacity,
      animatedOpacity,
      animatedVolume,
      blend: clip.trackIndex > 0 ? blend : null,
      dropped: [],
    }
  })

  // Resolve out-transitions. Fades (crossfade/dip/fade) become alpha windows;
  // slides become animated overlay offsets (outgoing 0->±1, incoming ∓1->0).
  // zoom/wipe have no frame-exact overlay/scale expression for their mask, so
  // they fall back to crossfade alpha — always reported, never silent.
  input.clips.forEach((clip, index) => {
    const transition = clip.outTransition
    if (!transition || transition.durationMs <= 0) return
    const node = clips[index]
    const end = clip.startMs + clip.durationMs
    const zone = Math.min(transition.durationMs, clip.durationMs)
    const slide = SLIDE_TRANSITIONS[transition.type]
    const isZoomIn = transition.type === 'zoom-in'
    const isZoomOut = transition.type === 'zoom-out'

    if (slide) {
      node.slideOut = {
        axis: slide.axis,
        fromFrac: 0,
        toFrac: slide.outTo,
        startMs: Math.max(0, clip.durationMs - zone),
        endMs: clip.durationMs,
      }
    } else if (isZoomIn || isZoomOut) {
      // Preview: zoom-in out 1->1.5, zoom-out out 1->0.7; both fully fade.
      node.zoomOut = {
        fromScale: 1,
        toScale: isZoomIn ? 1.5 : 0.7,
        startMs: Math.max(0, clip.durationMs - zone),
        endMs: clip.durationMs,
      }
      node.transitionFadeOutMs = Math.max(node.transitionFadeOutMs, zone)
    } else {
      if (!FADE_TRANSITIONS.has(transition.type)) {
        warnings.push(
          `clip[${index}]: transition '${transition.type}' exported as crossfade alpha (no frame-exact mapping)`
        )
      }
      node.transitionFadeOutMs = Math.max(node.transitionFadeOutMs, zone)
    }

    for (let j = 0; j < input.clips.length; j++) {
      if (j === index) continue
      const next = input.clips[j]
      if (next.trackIndex !== clip.trackIndex) continue
      if (next.startMs > clip.startMs && next.startMs < end) {
        const overlap = Math.min(zone, end - next.startMs, next.durationMs)
        if (overlap > 0) {
          if (slide) {
            clips[j].slideIn = {
              axis: slide.axis,
              fromFrac: -slide.outTo,
              toFrac: 0,
              startMs: 0,
              endMs: overlap,
            }
          } else if (isZoomIn || isZoomOut) {
            // Preview: zoom-in in 1.5->1, zoom-out in 0.7->1; both fade in.
            clips[j].zoomIn = {
              fromScale: isZoomIn ? 1.5 : 0.7,
              toScale: 1,
              startMs: 0,
              endMs: overlap,
            }
            clips[j].transitionFadeInMs = Math.max(clips[j].transitionFadeInMs, overlap)
          } else {
            clips[j].transitionFadeInMs = Math.max(clips[j].transitionFadeInMs, overlap)
          }
        }
      }
    }
    void end
  })

  const audioTracks: AudioExportNode[] = input.audioTracks.map((track, index) => {
    const audible =
      !resolveAudioMuted(track.muted ?? false, track.trackIndex, input.lanes) &&
      (track.volume ?? 1) !== 0
    const volumeTrack = (track.keyframes ?? []).find((t) => t.property === 'volume')
    return {
      index,
      audible,
      startMs: track.startMs,
      durationMs: track.durationMs ?? 0,
      trimStart: track.trimStart ?? 0,
      volume: track.volume ?? 1,
      fadeInMs: track.fadeInMs ?? 0,
      fadeOutMs: track.fadeOutMs ?? 0,
      animatedVolume: volumeTrack
        ? sampleTrackSegments(volumeTrack, track.durationMs ?? 0, track.volume ?? 1)
        : [],
    }
  })

  return { clips, audioTracks, warnings, dropped }
}
