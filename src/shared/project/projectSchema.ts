/**
 * projectSchema.ts — Shared project file validator + migration registry (SSOT).
 *
 * Implementation order step 1 (task.txt PHASE 1.1 / 1.3):
 * - Validate a project payload BEFORE loading and BEFORE saving.
 * - Detect corrupted projects with fail-closed, path-pinned errors.
 * - Normalize legacy shape drift to canonical runtime shapes.
 * - Support versioned migrations (v1 runtime shape -> v2 .clipzu envelope).
 *
 * Design constraints (verified against actual code, not assumed):
 * - Zero runtime dependencies and no Node/Electron APIs, so this module is
 *   importable from main, renderer, and preload alike. Only `import type`
 *   references to domain types (all erased at compile time).
 * - Canonical shapes mirror the RUNTIME types the app already reads/writes
 *   (Clip/AudioTrack/TextClip/Track/TimelineMarker in useTimeline.ts,
 *   KeyframeTrack in effects/types/Keyframe.ts, Modifier in
 *   effects/types/Modifier.ts) but are DECLARED HERE, not imported.
 * - The OLD declared `ProjectFile` interface in
 *   src/main/ipc/project.handler.ts described keyframes as
 *   { id, property, points: [{ timeMs, ... }] } and modifiers as
 *   { id, type, params, enabled, order }. The app NEVER produces those shapes
 *   (save passes live Zustand objects verbatim — see
 *   src/renderer/components/HotkeyManager.tsx:54-56). The validator accepts
 *   both and normalizes to the runtime shape, so genuinely old/hand-made
 *   files still load instead of being rejected.
 * - Defaults mirror src/renderer/store/useTimeline.ts:1385-1404
 *   (volume ?? 1, muted ?? false, hasAudio ?? true, speed ?? 1,
 *   fadeInMs/fadeOutMs ?? 0, audio sourceDurationMs ?? durationMs) and
 *   normalizeTextClip (endMs = startMs + durationMs) from
 *   src/shared/utils/timeline.ts:54-57.
 * STRICTNESS (no fallback, no silent error, no backward-compat tolerance):
 * - Every required field must be present and exactly typed. Nothing is
 *   defaulted, coerced, or "migrated" silently. Anything notable is an error.
 * - Legacy shape drift ({points/timeMs}, {params/order}) is REJECTED, not
 *   converted: the app never wrote those shapes, so their presence means a
 *   foreign or hand-corrupted file.
 * - `warnings` carries INFORMATION ONLY (unknown-field passthrough notices,
 *   migration notes). ok === true requires zero errors; warnings never rescue
 *   a failure and never change data.
 * - Unknown fields are still preserved verbatim (forward compatibility), but
 *   their presence is reported in warnings — never silent.
 * - No zod/io-ts dependency: this hand-rolled validator is the "or equivalent"
 *   allowed by task.txt, and avoids adding a dependency for a pure function.
 */

import type { CaptionStyle } from '../types/caption'

// ---------------------------------------------------------------------------
// Canonical entity types (file-format SSOT)
// ---------------------------------------------------------------------------
// These mirror the RUNTIME domain types (useTimeline.ts:142-305,
// Keyframe.ts:21-39, Modifier.ts:64-85) but are declared HERE so this module
// stays importable from the main process: tsconfig.node.json does not include
// src/renderer/**, so even `import type` of a renderer file would drag the
// whole renderer graph (zustand, window.electron, …) into the node build and
// break it (TS6307). Structural drift between these mirrors and the renderer
// types is caught by compile-time assertions in
// src/renderer/store/projectSchemaCompat.ts (web project only) — change either
// side incompatibly and `npm run typecheck:web` fails loudly.

/** Mirrors EasingType (Keyframe.ts:6-18). Bump together (see compat file). */
export type CanonicalEasing =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeOutBack'
  | 'easeOutExpo'
  | 'easeOutElastic'
  | 'easeOutBounce'

/** Mirrors BlendMode (useTimeline.ts:195-198). Bump together (see compat file). */
export type CanonicalBlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'soft-light' | 'difference'

/** Mirrors Keyframe (Keyframe.ts:21-30). */
export interface CanonicalKeyframe {
  time: number
  value: number | string | boolean
  easing: CanonicalEasing
}

/** Mirrors KeyframeTrack (Keyframe.ts:33-39). */
export interface CanonicalKeyframeTrack {
  property: string
  frames: CanonicalKeyframe[]
}

/** Mirrors Modifier (Modifier.ts:64-85). */
export interface CanonicalModifier {
  id: string
  type: 'effect' | 'animation' | 'transition'
  presetId: string
  enabled: boolean
  parameters: Record<string, number | string | boolean>
  keyframes: CanonicalKeyframeTrack[]
  version: number
}

/** Mirrors ClipTransform (useTimeline.ts:~120-134). Validated structurally. */
export interface CanonicalTransform {
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

/** Mirrors Clip (useTimeline.ts:160-192). Unknown fields preserved. */
export interface CanonicalClip {
  id: string
  path: string
  startMs: number
  sourceDurationMs: number
  durationMs: number
  trackIndex: number
  trimStart: number
  trimEnd: number
  name?: string
  hasAudio?: boolean
  transform?: CanonicalTransform
  speed: number
  volume: number
  muted: boolean
  fadeInMs?: number
  fadeOutMs?: number
  keyframes?: CanonicalKeyframeTrack[]
  modifiers?: CanonicalModifier[]
  outTransition?: { type: string; durationMs: number }
  blendMode?: CanonicalBlendMode
  proxyPath?: string
}

/** Mirrors AudioTrack (useTimeline.ts:200-225). */
export interface CanonicalAudioTrack {
  id: string
  path: string
  startMs: number
  sourceDurationMs: number
  durationMs: number
  volume: number
  muted: boolean
  name?: string
  role: 'voice' | 'music' | 'sfx' | 'ambient'
  trimStart: number
  trimEnd: number
  trackIndex: number
  fadeInMs?: number
  fadeOutMs?: number
  keyframes?: CanonicalKeyframeTrack[]
}

export interface CanonicalWord {
  word: string
  startMs: number
  endMs: number
}

/** Mirrors TextClip (useTimeline.ts:280-305). */
export interface CanonicalTextClip {
  id: string
  startMs: number
  durationMs: number
  endMs: number
  trackIndex: number
  text: string
  style?: CaptionStyle
  words?: CanonicalWord[]
  wordTimestampsSource?: 'whisper' | 'synthetic'
  sourceId?: string
  sourceType?: 'clip' | 'audioTrack' | 'timeline' | 'import'
  transcriptionJobId?: string
  originalWords?: CanonicalWord[]
  originalStartMs?: number
  originalEndMs?: number
  fadeInMs?: number
  fadeOutMs?: number
  keyframes?: CanonicalKeyframeTrack[]
}

/** Mirrors Track (useTimeline.ts:142-151). */
export interface CanonicalTrack {
  id: string
  index: number
  name: string
  kind: 'video' | 'audio' | 'caption' | 'overlay'
  muted: boolean
  locked: boolean
  hidden: boolean
  solo: boolean
}

/** Mirrors TimelineMarker (useTimeline.ts:153-158). */
export interface CanonicalMarker {
  id: string
  timeMs: number
  label: string
  color: string
}

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** Current runtime payload version sent by the saver (retained, not on disk). */
export const PROJECT_FORMAT_VERSION = '1.0'

/** Versions loadable without a registered migration. */
export const SUPPORTED_PROJECT_VERSIONS: readonly string[] = ['1.0']

/**
 * Refuses absurdly large payloads before JSON.parse (OOM guard).
 * 100 MB is far above any realistic project (pretty-printed JSON of even a
 * 1h timeline with word-level captions is single-digit MB).
 */
export const MAX_PROJECT_FILE_BYTES = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ProjectValidationIssue {
  /** Dotted/indexed path, e.g. "clips[3].keyframes[0].frames[1].time". */
  path: string
  message: string
}

export interface NormalizedCaptions {
  entries: CanonicalTextClip[]
  style: CaptionStyle
  language: string
  [unknownField: string]: unknown
}

/** Canonical in-memory shape. Extra unknown fields are preserved. */
export interface NormalizedProjectFile {
  version: string
  name: string
  fps: 24 | 30 | 60
  resolution: { width: number; height: number }
  aspectRatio: string
  backgroundColor: string
  clips: CanonicalClip[]
  audioTracks: CanonicalAudioTrack[]
  textClips: CanonicalTextClip[]
  tracks: CanonicalTrack[]
  markers: CanonicalMarker[]
  captions: NormalizedCaptions
  exportPreset: string
  playheadMs?: number
  zoom?: number
  masterVolume?: number
  loopEnabled?: boolean
  [unknownField: string]: unknown
}

export interface ProjectValidationResult {
  ok: boolean
  errors: ProjectValidationIssue[]
  warnings: string[]
  /** Present only when ok === true. */
  data?: NormalizedProjectFile
  /** Source version when a migration ran. */
  migratedFrom?: string
}

// ---------------------------------------------------------------------------
// Migration registry (v1 runtime shape -> v2 .clipzu; future versions register here)
// ---------------------------------------------------------------------------

export type ProjectMigration = (
  data: Record<string, unknown>
) => Record<string, unknown>

const migrationRegistry = new Map<string, ProjectMigration>()

/**
 * Register a migration FROM a legacy version TO the current structure.
 * Step 2 (.clipzu v2 envelope) will register its own entry here.
 */
export function registerProjectMigration(
  fromVersion: string,
  migrate: ProjectMigration
): void {
  migrationRegistry.set(fromVersion, migrate)
}

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function issue(
  errors: ProjectValidationIssue[],
  path: string,
  message: string
): void {
  errors.push({ path, message })
}

/**
 * Delete undefined-valued own keys in place. Normalized entities must never
 * carry explicit `key: undefined` entries: live store objects don't have them,
 * JSON drops them on disk, so their presence would make save→load fail
 * identity comparison while changing nothing semantically. Canonical shape =
 * absent keys, never undefined keys.
 */
function compact<T extends object>(obj: T): T {
  const record = obj as unknown as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key]
  }
  return obj
}

// Mirrors EasingType (src/renderer/effects/types/Keyframe.ts:6-15).
// Local copy keeps this module runtime-dependency-free; bump together.
const KNOWN_EASINGS: readonly string[] = [
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeOutBack',
  'easeOutExpo',
  'easeOutElastic',
  'easeOutBounce',
]

const TRACK_KINDS: readonly string[] = ['video', 'audio', 'caption', 'overlay']
const AUDIO_ROLES: readonly string[] = ['voice', 'music', 'sfx', 'ambient']
const KNOWN_BLEND_MODES: readonly string[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'soft-light',
  'difference',
]
/** Mirrors MODIFIER_SCHEMA_VERSION (Modifier.ts:61). Bump together. */
const CURRENT_MODIFIER_VERSION = 1
const ASPECT_RATIOS: readonly string[] = [
  '16:9',
  '9:16',
  '1:1',
  '4:5',
  '4:3',
  'custom',
]

// ---------------------------------------------------------------------------
// Keyframes / modifiers (shape-drift normalization)
// ---------------------------------------------------------------------------

interface NormalizeContext {
  errors: ProjectValidationIssue[]
  warnings: string[]
}

function normalizeKeyframeTrack(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalKeyframeTrack | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  const property = raw['property']
  if (typeof property !== 'string' || property.length === 0) {
    issue(ctx.errors, `${path}.property`, 'must be a non-empty string')
    return null
  }

  // Canonical shape ONLY: frames: [{ time, value, easing }].
  // The legacy {points/timeMs} shape the old interface described is REJECTED:
  // the app never wrote it, so its presence means corruption, not history.
  if (!Array.isArray(raw['frames'])) {
    issue(ctx.errors, `${path}.frames`, 'must be an array of { time, value, easing }')
    return null
  }
  const framesRaw = raw['frames'] as unknown[]
  if (framesRaw.length === 0) {
    issue(ctx.errors, `${path}.frames`, 'must contain at least one frame')
    return null
  }

  const frames: CanonicalKeyframe[] = []
  let failed = false
  for (let i = 0; i < framesRaw.length; i++) {
    const f = framesRaw[i]
    const fPath = `${path}.frames[${i}]`
    if (!isPlainObject(f)) {
      issue(ctx.errors, fPath, 'must be a plain object')
      failed = true
      continue
    }
    const timeRaw = f['time']
    if (!isFiniteNumber(timeRaw)) {
      issue(ctx.errors, `${fPath}.time`, 'must be a finite number')
      failed = true
      continue
    }
    const value = f['value']
    if (
      typeof value !== 'number' &&
      typeof value !== 'string' &&
      typeof value !== 'boolean'
    ) {
      issue(ctx.errors, `${fPath}.value`, 'must be a number, string, or boolean')
      failed = true
      continue
    }
    const easing = f['easing']
    if (typeof easing !== 'string' || !KNOWN_EASINGS.includes(easing)) {
      // No coercion: an unknown easing is corruption, not history.
      issue(ctx.errors, `${fPath}.easing`, `must be one of ${KNOWN_EASINGS.join(', ')}`)
      failed = true
      continue
    }
    frames.push({
      time: timeRaw,
      value,
      easing: easing as CanonicalEasing,
    })
  }
  if (failed) return null
  return { property, frames }
}

function normalizeModifier(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalModifier | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  const { id, type, enabled } = raw
  if (typeof id !== 'string' || id.length === 0) {
    issue(ctx.errors, `${path}.id`, 'must be a non-empty string')
    return null
  }
  if (
    type !== 'effect' &&
    type !== 'animation' &&
    type !== 'transition'
  ) {
    issue(ctx.errors, `${path}.type`, 'must be "effect", "animation", or "transition"')
    return null
  }
  if (typeof enabled !== 'boolean') {
    issue(ctx.errors, `${path}.enabled`, 'must be a boolean')
    return null
  }

  // Canonical shape ONLY: { presetId, parameters, keyframes, version }.
  // The legacy {params/order} shape is REJECTED (never written by the app).
  if (!isPlainObject(raw['parameters'])) {
    issue(ctx.errors, `${path}.parameters`, 'must be a plain object')
    return null
  }
  const paramsRaw = raw['parameters'] as Record<string, unknown>
  const parameters: Record<string, number | string | boolean> = {}
  for (const [key, val] of Object.entries(paramsRaw)) {
    if (typeof val !== 'number' && typeof val !== 'string' && typeof val !== 'boolean') {
      issue(ctx.errors, `${path}.parameters.${key}`, 'must be a number, string, or boolean')
      return null
    }
    parameters[key] = val
  }

  // presetId and version are always written by the app (EffectsPanel:157-161,
  // FiltersPanel:211-215): absence is corruption, not history.
  if (typeof raw['presetId'] !== 'string' || (raw['presetId'] as string).length === 0) {
    issue(ctx.errors, `${path}.presetId`, 'must be a non-empty string')
    return null
  }
  const presetId: string = raw['presetId'] as string
  const keyframesRaw = Array.isArray(raw['keyframes'])
    ? (raw['keyframes'] as unknown[])
    : []
  const keyframes: CanonicalKeyframeTrack[] = []
  for (let i = 0; i < keyframesRaw.length; i++) {
    const track = normalizeKeyframeTrack(
      keyframesRaw[i],
      `${path}.keyframes[${i}]`,
      ctx
    )
    if (track === null) return null
    keyframes.push(track)
  }
  if (typeof raw['version'] !== 'number') {
    issue(ctx.errors, `${path}.version`, 'must be a number')
    return null
  }
  const version: number = raw['version'] as number

  return {
    id,
    type,
    presetId,
    enabled,
    parameters,
    keyframes,
    version,
  }
}

function normalizeKeyframeTrackList(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalKeyframeTrack[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    issue(ctx.errors, path, 'must be an array')
    return null
  }
  const out: CanonicalKeyframeTrack[] = []
  for (let i = 0; i < raw.length; i++) {
    const track = normalizeKeyframeTrack(raw[i], `${path}[${i}]`, ctx)
    if (track === null) return null
    out.push(track)
  }
  return out
}

function normalizeModifierList(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalModifier[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    issue(ctx.errors, path, 'must be an array')
    return null
  }
  const out: CanonicalModifier[] = []
  for (let i = 0; i < raw.length; i++) {
    const mod = normalizeModifier(raw[i], `${path}[${i}]`, ctx)
    if (mod === null) return null
    out.push(mod)
  }
  return out
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function normalizeWordList(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): Array<{ word: string; startMs: number; endMs: number }> | null | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    issue(ctx.errors, path, 'must be an array')
    return null
  }
  const out: Array<{ word: string; startMs: number; endMs: number }> = []
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]
    const wPath = `${path}[${i}]`
    if (!isPlainObject(w)) {
      issue(ctx.errors, wPath, 'must be a plain object')
      return null
    }
    if (typeof w['word'] !== 'string') {
      issue(ctx.errors, `${wPath}.word`, 'must be a string')
      return null
    }
    if (!isFiniteNumber(w['startMs']) || !isFiniteNumber(w['endMs'])) {
      issue(ctx.errors, wPath, 'startMs/endMs must be finite numbers')
      return null
    }
    out.push({ word: w['word'], startMs: w['startMs'], endMs: w['endMs'] })
  }
  return out
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function normalizeClip(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalClip | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  if (typeof raw['id'] !== 'string' || raw['id'].length === 0) {
    issue(ctx.errors, `${path}.id`, 'must be a non-empty string')
    return null
  }
  // A clip without a media path can never resolve; fail closed.
  if (typeof raw['path'] !== 'string' || raw['path'].length === 0) {
    issue(ctx.errors, `${path}.path`, 'must be a non-empty string (portable-asset step will add relink UX)')
    return null
  }
  for (const field of [
    'startMs',
    'sourceDurationMs',
    'durationMs',
    'trackIndex',
    'trimStart',
    'trimEnd',
    'speed',
    'volume',
  ] as const) {
    if (!isFiniteNumber(raw[field])) {
      issue(ctx.errors, `${path}.${field}`, 'must be a finite number')
      return null
    }
  }
  if (typeof raw['muted'] !== 'boolean') {
    issue(ctx.errors, `${path}.muted`, 'must be a boolean')
    return null
  }
  const keyframes = normalizeKeyframeTrackList(raw['keyframes'], `${path}.keyframes`, ctx)
  if (keyframes === null) return null
  const modifiers = normalizeModifierList(raw['modifiers'], `${path}.modifiers`, ctx)
  if (modifiers === null) return null

  // Transform is ALWAYS full in real files: addClip defaults to
  // DEFAULT_TRANSFORM (useTimeline.ts:520) and setClipTransform merges partials
  // into the full object (useTimeline.ts:813-814). A missing or partial
  // transform is corruption — no silent completion.
  if (!isPlainObject(raw['transform'])) {
    issue(ctx.errors, `${path}.transform`, 'must be a full transform object')
    return null
  }
  const transformRaw = raw['transform'] as Record<string, unknown>
  for (const field of [
    'x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity',
    'cropTop', 'cropBottom', 'cropLeft', 'cropRight',
  ] as const) {
    if (!isFiniteNumber(transformRaw[field])) {
      issue(ctx.errors, `${path}.transform.${field}`, 'must be a finite number')
      return null
    }
  }
  const transform = transformRaw as unknown as CanonicalClip['transform']
  let outTransition: CanonicalClip['outTransition']
  if (raw['blendMode'] !== undefined) {
    if (typeof raw['blendMode'] !== 'string' || !KNOWN_BLEND_MODES.includes(raw['blendMode'] as string)) {
      issue(ctx.errors, `${path}.blendMode`, `must be one of ${KNOWN_BLEND_MODES.join(', ')}`)
      return null
    }
  }
  if (raw['outTransition'] !== undefined) {
    if (
      !isPlainObject(raw['outTransition']) ||
      typeof raw['outTransition']['type'] !== 'string' ||
      !isFiniteNumber(raw['outTransition']['durationMs'])
    ) {
      issue(ctx.errors, `${path}.outTransition`, 'must be { type: string, durationMs: number }')
      return null
    }
    outTransition = {
      type: raw['outTransition']['type'] as string,
      durationMs: raw['outTransition']['durationMs'] as number,
    }
  }

  // Defaults mirror useTimeline.loadTimeline (useTimeline.ts:1385-1393).
  // compact(): no explicit undefined keys — memory ≡ disk identity.
  return compact({
    ...raw,
    id: raw['id'] as string,
    path: raw['path'] as string,
    startMs: raw['startMs'] as number,
    sourceDurationMs: raw['sourceDurationMs'] as number,
    durationMs: raw['durationMs'] as number,
    trackIndex: raw['trackIndex'] as number,
    trimStart: raw['trimStart'] as number,
    trimEnd: raw['trimEnd'] as number,
    speed: (raw['speed'] as number) ?? 1,
    volume: (raw['volume'] as number) ?? 1,
    muted: raw['muted'] as boolean,
    hasAudio: (raw['hasAudio'] as boolean | undefined) ?? true,
    fadeInMs: (raw['fadeInMs'] as number | undefined) ?? 0,
    fadeOutMs: (raw['fadeOutMs'] as number | undefined) ?? 0,
    transform,
    keyframes: keyframes.length > 0 ? keyframes : undefined,
    modifiers: modifiers.length > 0 ? modifiers : undefined,
    outTransition,
    blendMode: raw['blendMode'] as CanonicalClip['blendMode'],
    name: raw['name'] as string | undefined,
    proxyPath: raw['proxyPath'] as string | undefined,
  } as CanonicalClip)
}

function normalizeAudioTrack(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalAudioTrack | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  if (typeof raw['id'] !== 'string' || raw['id'].length === 0) {
    issue(ctx.errors, `${path}.id`, 'must be a non-empty string')
    return null
  }
  if (typeof raw['path'] !== 'string' || raw['path'].length === 0) {
    issue(ctx.errors, `${path}.path`, 'must be a non-empty string')
    return null
  }
  for (const field of [
    'startMs',
    'durationMs',
    'volume',
    'trimStart',
    'trimEnd',
    'trackIndex',
  ] as const) {
    if (!isFiniteNumber(raw[field])) {
      issue(ctx.errors, `${path}.${field}`, 'must be a finite number')
      return null
    }
  }
  if (typeof raw['muted'] !== 'boolean') {
    issue(ctx.errors, `${path}.muted`, 'must be a boolean')
    return null
  }
  if (typeof raw['role'] !== 'string' || !AUDIO_ROLES.includes(raw['role'])) {
    issue(ctx.errors, `${path}.role`, `must be one of ${AUDIO_ROLES.join(', ')}`)
    return null
  }
  const keyframes = normalizeKeyframeTrackList(raw['keyframes'], `${path}.keyframes`, ctx)
  if (keyframes === null) return null

  // Defaults mirror useTimeline.loadTimeline (useTimeline.ts:1394-1399).
  // compact(): no explicit undefined keys — memory ≡ disk identity.
  return compact({
    ...raw,
    sourceDurationMs: (raw['sourceDurationMs'] as number | undefined) ?? (raw['durationMs'] as number),
    fadeInMs: (raw['fadeInMs'] as number | undefined) ?? 0,
    fadeOutMs: (raw['fadeOutMs'] as number | undefined) ?? 0,
    keyframes: keyframes.length > 0 ? keyframes : undefined,
  } as CanonicalAudioTrack)
}

const STYLE_ALIGNMENTS: readonly string[] = ['left', 'center', 'right']
const STYLE_POSITIONS: readonly string[] = ['top', 'center', 'bottom']
const STYLE_ANIMATIONS: readonly string[] = [
  'none', 'pop', 'fade', 'slide-up', 'karaoke', 'typewriter',
]
const STYLE_MODES: readonly string[] = [
  'full-phrase', 'word-reveal', 'karaoke', 'single-word',
]
const WORD_SOURCES: readonly string[] = ['whisper', 'synthetic']
const TEXT_SOURCE_TYPES: readonly string[] = ['clip', 'audioTrack', 'timeline', 'import']

function checkStringField(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  ctx: NormalizeContext
): boolean {
  if (typeof obj[field] !== 'string') {
    issue(ctx.errors, `${path}.${field}`, 'must be a string')
    return false
  }
  return true
}

function checkFiniteField(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  ctx: NormalizeContext
): boolean {
  if (!isFiniteNumber(obj[field])) {
    issue(ctx.errors, `${path}.${field}`, 'must be a finite number')
    return false
  }
  return true
}

/**
 * Strict CaptionStyle field check (spec: shared/types/caption.ts:23-91).
 * full=true: every required field must be present (global style — always
 * complete in real files, and partials would leave stale fields in the
 * Object.assign merge on load). full=false: per-clip style may be partial
 * (each PRESENT field strictly typed). Unknown keys are preserved with a
 * warning — reported, never silent.
 */
function checkCaptionStyleFields(
  raw: Record<string, unknown>,
  path: string,
  ctx: NormalizeContext,
  full: boolean
): boolean {
  let ok = true
  const stringFields = ['fontFamily', 'color', 'strokeColor', 'bgColor'] as const
  const numberFields = [
    'fontSize', 'fontWeight', 'strokeWidth', 'bgOpacity',
    'x', 'y', 'rotation', 'scale',
  ] as const
  for (const field of stringFields) {
    if (full || raw[field] !== undefined) {
      if (!checkStringField(raw, field, path, ctx)) ok = false
    }
  }
  for (const field of numberFields) {
    if (full || raw[field] !== undefined) {
      if (!checkFiniteField(raw, field, path, ctx)) ok = false
    }
  }
  const enumChecks: Array<{ field: string; allowed: readonly string[] }> = [
    { field: 'alignment', allowed: STYLE_ALIGNMENTS },
    { field: 'position', allowed: STYLE_POSITIONS },
    { field: 'animation', allowed: STYLE_ANIMATIONS },
    { field: 'captionMode', allowed: STYLE_MODES },
  ]
  for (const { field, allowed } of enumChecks) {
    if (full || raw[field] !== undefined) {
      if (typeof raw[field] !== 'string' || !allowed.includes(raw[field] as string)) {
        issue(ctx.errors, `${path}.${field}`, `must be one of ${allowed.join(', ')}`)
        ok = false
      }
    }
  }
  // Optional fields: undefined or exactly typed. Anything else is corruption.
  if (raw['revealFadeMs'] !== undefined && !isFiniteNumber(raw['revealFadeMs'])) {
    issue(ctx.errors, `${path}.revealFadeMs`, 'must be a finite number')
    ok = false
  }
  for (const field of ['activeHighlightColor', 'activeTextColor'] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') {
      issue(ctx.errors, `${path}.${field}`, 'must be a string')
      ok = false
    }
  }
  if (raw['activeScale'] !== undefined && !isFiniteNumber(raw['activeScale'])) {
    issue(ctx.errors, `${path}.activeScale`, 'must be a finite number')
    ok = false
  }
  const known = new Set<string>([
    ...stringFields, ...numberFields,
    'alignment', 'position', 'animation', 'captionMode',
    'revealFadeMs', 'activeHighlightColor', 'activeTextColor', 'activeScale',
  ])
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      ctx.warnings.push(`${path}.${key}: unknown style field preserved`)
    }
  }
  return ok
}

function normalizeCaptionStyleFull(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CaptionStyle | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  if (!checkCaptionStyleFields(raw, path, ctx, true)) return null
  return { ...(raw as object) } as CaptionStyle
}

function normalizeCaptionStylePartial(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CaptionStyle | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  if (!checkCaptionStyleFields(raw, path, ctx, false)) return null
  return { ...(raw as object) } as CaptionStyle
}

function normalizeTextClip(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalTextClip | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  if (typeof raw['id'] !== 'string' || raw['id'].length === 0) {
    issue(ctx.errors, `${path}.id`, 'must be a non-empty string')
    return null
  }
  if (typeof raw['text'] !== 'string') {
    issue(ctx.errors, `${path}.text`, 'must be a string')
    return null
  }
  for (const field of ['startMs', 'durationMs', 'trackIndex'] as const) {
    if (!isFiniteNumber(raw[field])) {
      issue(ctx.errors, `${path}.${field}`, 'must be a finite number')
      return null
    }
  }
  // Per-clip style may be partial (style?: CaptionStyle) — each present field
  // strictly typed, never coerced.
  if (raw['style'] !== undefined) {
    if (normalizeCaptionStylePartial(raw['style'], `${path}.style`, ctx) === null) {
      return null
    }
  }
  if (
    raw['wordTimestampsSource'] !== undefined &&
    (typeof raw['wordTimestampsSource'] !== 'string' ||
      !WORD_SOURCES.includes(raw['wordTimestampsSource'] as string))
  ) {
    issue(ctx.errors, `${path}.wordTimestampsSource`, `must be one of ${WORD_SOURCES.join(', ')}`)
    return null
  }
  if (
    raw['sourceType'] !== undefined &&
    (typeof raw['sourceType'] !== 'string' ||
      !TEXT_SOURCE_TYPES.includes(raw['sourceType'] as string))
  ) {
    issue(ctx.errors, `${path}.sourceType`, `must be one of ${TEXT_SOURCE_TYPES.join(', ')}`)
    return null
  }
  for (const field of ['sourceId', 'transcriptionJobId'] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') {
      issue(ctx.errors, `${path}.${field}`, 'must be a string')
      return null
    }
  }
  for (const field of ['originalStartMs', 'originalEndMs'] as const) {
    if (raw[field] !== undefined && !isFiniteNumber(raw[field])) {
      issue(ctx.errors, `${path}.${field}`, 'must be a finite number')
      return null
    }
  }
  const words = normalizeWordList(raw['words'], `${path}.words`, ctx)
  if (words === null) return null
  const originalWords = normalizeWordList(raw['originalWords'], `${path}.originalWords`, ctx)
  if (originalWords === null) return null
  const keyframes = normalizeKeyframeTrackList(raw['keyframes'], `${path}.keyframes`, ctx)
  if (keyframes === null) return null

  const startMs = raw['startMs'] as number
  const durationMs = raw['durationMs'] as number
  // Invariant is normalizeTextClip (shared/utils/timeline.ts:54-57):
  // endMs MUST equal startMs + durationMs on disk. A mismatch is corruption —
  // recomputing silently would hide a broken writer.
  const endMs = startMs + durationMs
  if (raw['endMs'] !== endMs) {
    issue(
      ctx.errors,
      `${path}.endMs`,
      `must equal startMs + durationMs (${endMs}), got ${String(raw['endMs'])}`
    )
    return null
  }

  return compact({
    ...raw,
    startMs,
    durationMs,
    endMs,
    words: words ?? undefined,
    originalWords: originalWords ?? undefined,
    fadeInMs: (raw['fadeInMs'] as number | undefined) ?? 0,
    fadeOutMs: (raw['fadeOutMs'] as number | undefined) ?? 0,
    keyframes: keyframes.length > 0 ? keyframes : undefined,
  } as CanonicalTextClip)
}

function normalizeTrack(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalTrack | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  if (typeof raw['id'] !== 'string' || raw['id'].length === 0) {
    issue(ctx.errors, `${path}.id`, 'must be a non-empty string')
    return null
  }
  if (!isFiniteNumber(raw['index']) || typeof raw['name'] !== 'string') {
    issue(ctx.errors, path, 'index must be a number and name a string')
    return null
  }
  if (typeof raw['kind'] !== 'string' || !TRACK_KINDS.includes(raw['kind'])) {
    issue(ctx.errors, `${path}.kind`, `must be one of ${TRACK_KINDS.join(', ')}`)
    return null
  }
  for (const field of ['muted', 'locked', 'hidden', 'solo'] as const) {
    if (typeof raw[field] !== 'boolean') {
      issue(ctx.errors, `${path}.${field}`, 'must be a boolean')
      return null
    }
  }
  return { ...(raw as object) } as CanonicalTrack
}

function normalizeMarker(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalMarker | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  if (typeof raw['id'] !== 'string' || raw['id'].length === 0) {
    issue(ctx.errors, `${path}.id`, 'must be a non-empty string')
    return null
  }
  if (!isFiniteNumber(raw['timeMs'])) {
    issue(ctx.errors, `${path}.timeMs`, 'must be a finite number')
    return null
  }
  if (typeof raw['label'] !== 'string' || typeof raw['color'] !== 'string') {
    issue(ctx.errors, path, 'label and color must be strings')
    return null
  }
  return { ...(raw as object) } as CanonicalMarker
}

function normalizeEntityList<T>(
  raw: unknown,
  path: string,
  ctx: NormalizeContext,
  normalize: (item: unknown, itemPath: string, ctx: NormalizeContext) => T | null
): T[] | null {
  if (raw === undefined || raw === null) {
    // Every array section is always written by the saver (HotkeyManager
    // serializes live store arrays, which are never undefined). Absence is
    // corruption — no silent [] substitution.
    issue(ctx.errors, path, 'is required and must be an array')
    return null
  }
  if (!Array.isArray(raw)) {
    issue(ctx.errors, path, 'must be an array')
    return null
  }
  const out: T[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = normalize(raw[i], `${path}[${i}]`, ctx)
    if (item === null) return null
    out.push(item)
  }
  return out
}

// ---------------------------------------------------------------------------
// Top-level validation
// ---------------------------------------------------------------------------

/**
 * Validate + normalize an unknown payload into the canonical project shape.
 * Pure function: no I/O, no side effects (besides reading the migration
 * registry). Safe to call in main AND renderer.
 */
export function validateProjectFile(raw: unknown): ProjectValidationResult {
  const errors: ProjectValidationIssue[] = []
  const warnings: string[] = []

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'project must be a JSON object' }],
      warnings,
    }
  }
  let data: Record<string, unknown> = raw
  let migratedFrom: string | undefined

  const versionRaw = data['version']
  // Version is mandatory: every file the app ever wrote carries version '1.0'
  // (HotkeyManager.tsx:48). A missing version is corruption, not legacy.
  if (typeof versionRaw !== 'string') {
    return {
      ok: false,
      errors: [{ path: 'version', message: 'is required and must be a string' }],
      warnings,
    }
  } else if (
    versionRaw !== PROJECT_FORMAT_VERSION &&
    !(SUPPORTED_PROJECT_VERSIONS as readonly string[]).includes(versionRaw)
  ) {
    const migrate = migrationRegistry.get(versionRaw)
    if (!migrate) {
      return {
        ok: false,
        errors: [
          {
            path: 'version',
            message: `unsupported project version "${versionRaw}" (current: "${PROJECT_FORMAT_VERSION}"); file not loaded`,
          },
        ],
        warnings,
      }
    }
    try {
      data = migrate(data)
    } catch (e) {
      return {
        ok: false,
        errors: [
          {
            path: 'version',
            message: `migration from "${versionRaw}" failed: ${(e as Error).message}`,
          },
        ],
        warnings,
      }
    }
    migratedFrom = versionRaw
  }

  const ctx: NormalizeContext = { errors, warnings }

  if (typeof data['name'] !== 'string' || data['name'].length === 0) {
    issue(errors, 'name', 'must be a non-empty string')
  }
  const fps = data['fps']
  if (fps !== 24 && fps !== 30 && fps !== 60) {
    // Fail closed: useProject restricts fps to 24|30|60 (useProject.ts:29)
    // and export derives timing from it. A corrupt fps must not flow through.
    issue(errors, 'fps', 'must be 24, 30, or 60')
  }
  const resolution = data['resolution']
  if (
    !isPlainObject(resolution) ||
    !isFiniteNumber(resolution['width']) ||
    (resolution['width'] as number) <= 0 ||
    !isFiniteNumber(resolution['height']) ||
    (resolution['height'] as number) <= 0
  ) {
    issue(errors, 'resolution', 'must be { width: number > 0, height: number > 0 }')
  }
  // aspectRatio and backgroundColor are always written by the saver
  // (useProject initialState: aspectRatio, backgroundColor). Required.
  if (
    typeof data['aspectRatio'] !== 'string' ||
    !ASPECT_RATIOS.includes(data['aspectRatio'] as string)
  ) {
    issue(errors, 'aspectRatio', `is required and must be one of ${ASPECT_RATIOS.join(', ')}`)
  }
  if (
    typeof data['backgroundColor'] !== 'string' ||
    (data['backgroundColor'] as string).length === 0
  ) {
    issue(errors, 'backgroundColor', 'is required and must be a non-empty string')
  }

  const clips = normalizeEntityList(data['clips'], 'clips', ctx, normalizeClip)
  const audioTracks = normalizeEntityList(data['audioTracks'], 'audioTracks', ctx, normalizeAudioTrack)
  const textClips = normalizeEntityList(data['textClips'], 'textClips', ctx, normalizeTextClip)
  const tracks = normalizeEntityList(data['tracks'], 'tracks', ctx, normalizeTrack)
  const markers = normalizeEntityList(data['markers'], 'markers', ctx, normalizeMarker)

  // Captions block: entries MUST deep-equal timeline.textClips (the saver writes
  // the same array reference twice). Any divergence is corruption — the loader
  // must never silently prefer one copy over the other.
  // Style here is the FULL global style (activeStyle is always complete);
  // partial styles are rejected so stale fields can never hide in a merge.
  let captions: NormalizedCaptions | null = null
  const captionsRaw = data['captions']
  if (!isPlainObject(captionsRaw)) {
    issue(errors, 'captions', 'is required and must be a plain object')
  } else {
    const entries = normalizeEntityList(
      captionsRaw['entries'],
      'captions.entries',
      ctx,
      normalizeTextClip
    )
    if (entries === null) {
      captions = null
    } else if (!isPlainObject(captionsRaw['style'])) {
      issue(errors, 'captions.style', 'is required and must be a plain object')
      captions = null
    } else {
      const styleResult = normalizeCaptionStyleFull(
        captionsRaw['style'],
        'captions.style',
        ctx
      )
      if (styleResult === null) {
        captions = null
      } else if (typeof captionsRaw['language'] !== 'string' || (captionsRaw['language'] as string).length === 0) {
        issue(errors, 'captions.language', 'is required and must be a non-empty string')
        captions = null
      } else {
        captions = {
          ...(captionsRaw as object),
          entries,
          style: styleResult,
          language: captionsRaw['language'] as string,
        }
      }
    }
  }

  // The saver always writes a preset key (useExport initialState). Absence or
  // emptiness is corruption — no silent "" substitution.
  if (typeof data['exportPreset'] !== 'string' || (data['exportPreset'] as string).length === 0) {
    issue(errors, 'exportPreset', 'is required and must be a non-empty string')
  }
  const exportPreset = data['exportPreset']

  for (const field of ['playheadMs', 'zoom', 'masterVolume'] as const) {
    if (data[field] !== undefined && !isFiniteNumber(data[field])) {
      issue(errors, field, 'must be a finite number')
    }
  }
  if (data['loopEnabled'] !== undefined && typeof data['loopEnabled'] !== 'boolean') {
    issue(errors, 'loopEnabled', 'must be a boolean')
  }

  // captions.entries MUST deep-equal timeline.textClips. Both normalizers are
  // deterministic, so any difference means the two copies diverged on disk —
  // corruption the loader must report, never silently prefer one side.
  if (textClips !== null && captions !== null) {
    if (JSON.stringify(textClips) !== JSON.stringify(captions.entries)) {
      issue(
        errors,
        'captions.entries',
        'must deep-equal timeline.textClips (copies diverged on disk)'
      )
      captions = null
    }
  }

  // Unknown top-level fields are preserved verbatim (forward compatibility)
  // and REPORTED — never silent.
  const knownTopLevel = new Set([
    'version', 'name', 'fps', 'resolution', 'aspectRatio', 'backgroundColor',
    'clips', 'audioTracks', 'textClips', 'tracks', 'markers', 'captions',
    'exportPreset', 'playheadMs', 'zoom', 'masterVolume', 'loopEnabled',
    'exportConfig',
  ])
  for (const key of Object.keys(data)) {
    if (!knownTopLevel.has(key)) {
      warnings.push(`${key}: unknown top-level field preserved`)
    }
  }

  if (
    errors.length > 0 ||
    clips === null ||
    audioTracks === null ||
    textClips === null ||
    tracks === null ||
    markers === null ||
    captions === null ||
    typeof exportPreset !== 'string'
  ) {
    return { ok: false, errors, warnings, migratedFrom }
  }

  return {
    ok: true,
    errors,
    warnings,
    migratedFrom,
    data: {
      ...data,
      version: PROJECT_FORMAT_VERSION,
      name: data['name'] as string,
      fps: data['fps'] as 24 | 30 | 60,
      resolution: {
        width: (data['resolution'] as { width: number }).width,
        height: (data['resolution'] as { height: number }).height,
      },
      aspectRatio: data['aspectRatio'] as string,
      backgroundColor: data['backgroundColor'] as string,
      clips,
      audioTracks,
      textClips,
      tracks,
      markers,
      captions,
      exportPreset,
      playheadMs: data['playheadMs'] as number | undefined,
      zoom: data['zoom'] as number | undefined,
      masterVolume: data['masterVolume'] as number | undefined,
      loopEnabled: data['loopEnabled'] as boolean | undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// .clipzu envelope (v2) — task.txt Step 2
// ---------------------------------------------------------------------------
// Write path is .clipzu ONLY. The v1 runtime payload is validated strictly,
// then migrated explicitly via migrateV1ToClipzuStrict below. Nothing is
// defaulted, coerced, or silently carried over: every unmappable input is
// an error.

/** On-disk format version written by the app from Step 2 on. */
export const CLIPZU_FORMAT_VERSION = '2.0'

/** Field names exactly as specified in task.txt Step 2. */
export interface AssetRecord {
  id: string
  filename: string
  /** Forward-slash path relative to the .clipzu file directory. */
  relativePath: string
  /** Absolute path where the file lived at save time (fallback candidate). */
  originalPath: string
  /** SHA-256 hex of file bytes (64 lowercase hex chars). */
  hash: string
  /** File duration in milliseconds (from referencing usage, verified equal). */
  duration: number
  metadata: {
    sizeBytes: number
    mtimeMs: number
  }
}

/**
 * Stored clip: canonical clip WITHOUT `path` PLUS `assetId`.
 * `path` on disk is FORBIDDEN (error if present): a stored absolute path and
 * an assetId are two sources of truth — the envelope keeps exactly one.
 * The absolute path is re-injected at load time after manifest resolution.
 */
export interface StoredClip extends Omit<CanonicalClip, 'path' | 'proxyPath'> {
  assetId: string
}

/** Stored audio track: same path/assetId rule as StoredClip. */
export interface StoredAudioTrack extends Omit<CanonicalAudioTrack, 'path'> {
  assetId: string
}

export interface CanonicalExportConfig {
  preset:
    | 'tiktok-reels' | 'youtube' | 'instagram-post' | 'instagram-port'
    | '4k-vertical' | '4k-horizontal' | 'prores' | 'webm' | 'custom'
  customWidth: number
  customHeight: number
  upscaleEnabled: boolean
  upscaleAlgorithm: 'lanczos' | 'bicubic'
  codec: 'h264' | 'h265' | 'prores' | 'vp9'
  qualityPreset: 'fast' | 'slow'
  bitrateKbps: number | null
  bitrateMode: 'auto' | 'cbr' | 'vbr'
  exportFrameRange: { startMs: number; endMs: number } | null
  audioOnly: boolean
  fps: 24 | 30 | 60
  hardwareAccel: boolean
}

export interface ClipzuDocument {
  version: '2.0'
  metadata: {
    name: string
    fps: 24 | 30 | 60
    resolution: { width: number; height: number }
    aspectRatio: string
    backgroundColor: string
  }
  assets: AssetRecord[]
  timeline: {
    clips: StoredClip[]
    audioTracks: StoredAudioTrack[]
    textClips: CanonicalTextClip[]
    markers: CanonicalMarker[]
  }
  tracks: CanonicalTrack[]
  captions: {
    entries: CanonicalTextClip[]
    style: CaptionStyle
    language: string
  }
  /** Provenance for the modifier stacks inside timeline (interpretation key). */
  effects: {
    modifierSchemaVersion: number
  }
  settings: {
    playheadMs: number
    zoom: number
    masterVolume: number
    loopEnabled: boolean
  }
  exportConfig: CanonicalExportConfig
  dependencies: {
    appVersion: string
    /** MUST equal the manifest id set exactly (no unreferenced, no missing). */
    assets: string[]
  }
}

/**
 * Renderer-facing loaded project: canonical runtime shapes with absolute
 * paths injected (assetId stripped — renderer Clip has no assetId field).
 * Built by main after manifest resolution; renderer restores stores from it.
 */
export interface LoadedProjectFile {
  version: '2.0'
  name: string
  fps: 24 | 30 | 60
  resolution: { width: number; height: number }
  aspectRatio: string
  backgroundColor: string
  clips: CanonicalClip[]
  audioTracks: CanonicalAudioTrack[]
  textClips: CanonicalTextClip[]
  tracks: CanonicalTrack[]
  markers: CanonicalMarker[]
  captions: {
    entries: CanonicalTextClip[]
    style: CaptionStyle
    language: string
  }
  playheadMs: number
  zoom: number
  masterVolume: number
  loopEnabled: boolean
  exportConfig: CanonicalExportConfig
}

export interface ClipzuValidationResult {
  ok: boolean
  errors: ProjectValidationIssue[]
  warnings: string[]
  data?: ClipzuDocument
}

const EXPORT_PRESETS: readonly string[] = [
  'tiktok-reels', 'youtube', 'instagram-post', 'instagram-port',
  '4k-vertical', '4k-horizontal', 'prores', 'webm', 'custom',
]
const UPSCALE_ALGOS: readonly string[] = ['lanczos', 'bicubic']
const CODECS: readonly string[] = ['h264', 'h265', 'prores', 'vp9']
const QUALITY_PRESETS: readonly string[] = ['fast', 'slow']
const BITRATE_MODES: readonly string[] = ['auto', 'cbr', 'vbr']

function normalizeAssetRecord(
  raw: unknown,
  path: string,
  ctx: NormalizeContext,
  seenIds: Set<string>
): AssetRecord | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  for (const field of ['id', 'filename', 'relativePath', 'originalPath'] as const) {
    if (typeof raw[field] !== 'string' || (raw[field] as string).length === 0) {
      issue(ctx.errors, `${path}.${field}`, 'is required and must be a non-empty string')
      return null
    }
  }
  const id = raw['id'] as string
  if (seenIds.has(id)) {
    issue(ctx.errors, `${path}.id`, `duplicate asset id "${id}"`)
    return null
  }
  seenIds.add(id)
  if (typeof raw['hash'] !== 'string' || !/^[0-9a-f]{64}$/.test(raw['hash'])) {
    issue(ctx.errors, `${path}.hash`, 'must be a 64-char lowercase SHA-256 hex string')
    return null
  }
  if (!isFiniteNumber(raw['duration']) || (raw['duration'] as number) < 0) {
    issue(ctx.errors, `${path}.duration`, 'must be a finite number >= 0 (milliseconds)')
    return null
  }
  const metadata = raw['metadata']
  if (
    !isPlainObject(metadata) ||
    !isFiniteNumber(metadata['sizeBytes']) ||
    (metadata['sizeBytes'] as number) < 0 ||
    !isFiniteNumber(metadata['mtimeMs'])
  ) {
    issue(ctx.errors, `${path}.metadata`, 'must be { sizeBytes: number >= 0, mtimeMs: number }')
    return null
  }
  return {
    ...(raw as object),
    id,
    filename: raw['filename'] as string,
    relativePath: (raw['relativePath'] as string).replace(/\\/g, '/'),
    originalPath: raw['originalPath'] as string,
    hash: raw['hash'] as string,
    duration: raw['duration'] as number,
    metadata: {
      sizeBytes: metadata['sizeBytes'] as number,
      mtimeMs: metadata['mtimeMs'] as number,
    },
  } as AssetRecord
}

function normalizeExportConfig(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): CanonicalExportConfig | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'is required and must be a plain object')
    return null
  }
  if (typeof raw['preset'] !== 'string' || !EXPORT_PRESETS.includes(raw['preset'])) {
    issue(ctx.errors, `${path}.preset`, `must be one of ${EXPORT_PRESETS.join(', ')}`)
    return null
  }
  for (const field of ['customWidth', 'customHeight'] as const) {
    if (!isFiniteNumber(raw[field]) || (raw[field] as number) < 0) {
      issue(ctx.errors, `${path}.${field}`, 'must be a finite number >= 0')
      return null
    }
  }
  for (const field of ['upscaleEnabled', 'audioOnly', 'hardwareAccel'] as const) {
    if (typeof raw[field] !== 'boolean') {
      issue(ctx.errors, `${path}.${field}`, 'must be a boolean')
      return null
    }
  }
  if (typeof raw['upscaleAlgorithm'] !== 'string' || !UPSCALE_ALGOS.includes(raw['upscaleAlgorithm'])) {
    issue(ctx.errors, `${path}.upscaleAlgorithm`, `must be one of ${UPSCALE_ALGOS.join(', ')}`)
    return null
  }
  if (typeof raw['codec'] !== 'string' || !CODECS.includes(raw['codec'])) {
    issue(ctx.errors, `${path}.codec`, `must be one of ${CODECS.join(', ')}`)
    return null
  }
  if (typeof raw['qualityPreset'] !== 'string' || !QUALITY_PRESETS.includes(raw['qualityPreset'])) {
    issue(ctx.errors, `${path}.qualityPreset`, `must be one of ${QUALITY_PRESETS.join(', ')}`)
    return null
  }
  if (
    raw['bitrateKbps'] !== null &&
    (!isFiniteNumber(raw['bitrateKbps']) || (raw['bitrateKbps'] as number) < 0)
  ) {
    issue(ctx.errors, `${path}.bitrateKbps`, 'must be null or a finite number >= 0')
    return null
  }
  if (typeof raw['bitrateMode'] !== 'string' || !BITRATE_MODES.includes(raw['bitrateMode'])) {
    issue(ctx.errors, `${path}.bitrateMode`, `must be one of ${BITRATE_MODES.join(', ')}`)
    return null
  }
  const range = raw['exportFrameRange']
  if (
    range !== null &&
    (!isPlainObject(range) ||
      !isFiniteNumber(range['startMs']) ||
      !isFiniteNumber(range['endMs']))
  ) {
    issue(ctx.errors, `${path}.exportFrameRange`, 'must be null or { startMs: number, endMs: number }')
    return null
  }
  const fps = raw['fps']
  if (fps !== 24 && fps !== 30 && fps !== 60) {
    issue(ctx.errors, `${path}.fps`, 'must be 24, 30, or 60')
    return null
  }
  return { ...(raw as object) } as CanonicalExportConfig
}

function normalizeStoredClip(
  raw: unknown,
  path: string,
  ctx: NormalizeContext,
  assetIds: Set<string>
): StoredClip | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  // Dual-source guard: a stored clip carries assetId, NEVER an absolute path.
  if ('path' in raw) {
    issue(ctx.errors, `${path}.path`, 'must NOT be present in .clipzu (assetId is the single source)')
    return null
  }
  if (typeof raw['assetId'] !== 'string' || (raw['assetId'] as string).length === 0) {
    issue(ctx.errors, `${path}.assetId`, 'is required and must be a non-empty string')
    return null
  }
  if (!assetIds.has(raw['assetId'] as string)) {
    issue(
      ctx.errors,
      `${path}.assetId`,
      `references unknown asset "${raw['assetId'] as string}" (not in manifest)`
    )
    return null
  }
  // Field-by-field check mirrors normalizeClip exactly (minus path/assetId);
  // the two are kept in sync by review + the save→load identity test.
  const checked = normalizeClipShell(raw, path, ctx)
  if (checked === null) return null
  return { ...checked, assetId: raw['assetId'] as string } as StoredClip
}

/**
 * Canonical clip validation for stored (pathless) clips. Mirrors
 * normalizeClip field-for-field except the path/assetId rule, so the two can
 * never drift: any field added to normalizeClip must be added here (enforced
 * by review, and by the round-trip test asserting save→load identity).
 */
function normalizeClipShell(
  raw: unknown,
  path: string,
  ctx: NormalizeContext
): Omit<StoredClip, 'assetId'> | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  if (typeof raw['id'] !== 'string' || raw['id'].length === 0) {
    issue(ctx.errors, `${path}.id`, 'must be a non-empty string')
    return null
  }
  // proxyPath is machine-local cache (see migrateV1ToClipzuStrict): it must
  // NEVER be stored. Presence on disk is corruption, not state.
  if ('proxyPath' in raw) {
    issue(ctx.errors, `${path}.proxyPath`, 'must NOT be stored in .clipzu (regenerable cache)')
    return null
  }
  for (const field of [
    'startMs',
    'sourceDurationMs',
    'durationMs',
    'trackIndex',
    'trimStart',
    'trimEnd',
    'speed',
    'volume',
  ] as const) {
    if (!isFiniteNumber(raw[field])) {
      issue(ctx.errors, `${path}.${field}`, 'must be a finite number')
      return null
    }
  }
  if (typeof raw['muted'] !== 'boolean') {
    issue(ctx.errors, `${path}.muted`, 'must be a boolean')
    return null
  }
  const keyframes = normalizeKeyframeTrackList(raw['keyframes'], `${path}.keyframes`, ctx)
  if (keyframes === null) return null
  const modifiers = normalizeModifierList(raw['modifiers'], `${path}.modifiers`, ctx)
  if (modifiers === null) return null
  if (!isPlainObject(raw['transform'])) {
    issue(ctx.errors, `${path}.transform`, 'must be a full transform object')
    return null
  }
  const transformRaw = raw['transform'] as Record<string, unknown>
  for (const field of [
    'x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity',
    'cropTop', 'cropBottom', 'cropLeft', 'cropRight',
  ] as const) {
    if (!isFiniteNumber(transformRaw[field])) {
      issue(ctx.errors, `${path}.transform.${field}`, 'must be a finite number')
      return null
    }
  }
  let outTransition: StoredClip['outTransition']
  if (raw['outTransition'] !== undefined) {
    if (
      !isPlainObject(raw['outTransition']) ||
      typeof raw['outTransition']['type'] !== 'string' ||
      !isFiniteNumber(raw['outTransition']['durationMs'])
    ) {
      issue(ctx.errors, `${path}.outTransition`, 'must be { type: string, durationMs: number }')
      return null
    }
    outTransition = {
      type: raw['outTransition']['type'] as string,
      durationMs: raw['outTransition']['durationMs'] as number,
    }
  }
  if (raw['blendMode'] !== undefined) {
    if (typeof raw['blendMode'] !== 'string' || !KNOWN_BLEND_MODES.includes(raw['blendMode'] as string)) {
      issue(ctx.errors, `${path}.blendMode`, `must be one of ${KNOWN_BLEND_MODES.join(', ')}`)
      return null
    }
  }
  return compact({
    ...raw,
    id: raw['id'] as string,
    startMs: raw['startMs'] as number,
    sourceDurationMs: raw['sourceDurationMs'] as number,
    durationMs: raw['durationMs'] as number,
    trackIndex: raw['trackIndex'] as number,
    trimStart: raw['trimStart'] as number,
    trimEnd: raw['trimEnd'] as number,
    speed: raw['speed'] as number,
    volume: raw['volume'] as number,
    muted: raw['muted'] as boolean,
    hasAudio: (raw['hasAudio'] as boolean | undefined) ?? true,
    fadeInMs: (raw['fadeInMs'] as number | undefined) ?? 0,
    fadeOutMs: (raw['fadeOutMs'] as number | undefined) ?? 0,
    transform: transformRaw as unknown as CanonicalTransform,
    keyframes: keyframes.length > 0 ? keyframes : undefined,
    modifiers: modifiers.length > 0 ? modifiers : undefined,
    outTransition,
    blendMode: raw['blendMode'] as StoredClip['blendMode'],
    name: raw['name'] as string | undefined,
  } as Omit<StoredClip, 'assetId'>)
}

function normalizeStoredAudioTrack(
  raw: unknown,
  path: string,
  ctx: NormalizeContext,
  assetIds: Set<string>
): StoredAudioTrack | null {
  if (!isPlainObject(raw)) {
    issue(ctx.errors, path, 'must be a plain object')
    return null
  }
  if ('path' in raw) {
    issue(ctx.errors, `${path}.path`, 'must NOT be present in .clipzu (assetId is the single source)')
    return null
  }
  if (typeof raw['assetId'] !== 'string' || (raw['assetId'] as string).length === 0) {
    issue(ctx.errors, `${path}.assetId`, 'is required and must be a non-empty string')
    return null
  }
  if (!assetIds.has(raw['assetId'] as string)) {
    issue(
      ctx.errors,
      `${path}.assetId`,
      `references unknown asset "${raw['assetId'] as string}" (not in manifest)`
    )
    return null
  }
  if (typeof raw['id'] !== 'string' || raw['id'].length === 0) {
    issue(ctx.errors, `${path}.id`, 'must be a non-empty string')
    return null
  }
  for (const field of [
    'startMs',
    'durationMs',
    'volume',
    'trimStart',
    'trimEnd',
    'trackIndex',
  ] as const) {
    if (!isFiniteNumber(raw[field])) {
      issue(ctx.errors, `${path}.${field}`, 'must be a finite number')
      return null
    }
  }
  if (typeof raw['muted'] !== 'boolean') {
    issue(ctx.errors, `${path}.muted`, 'must be a boolean')
    return null
  }
  if (typeof raw['role'] !== 'string' || !AUDIO_ROLES.includes(raw['role'])) {
    issue(ctx.errors, `${path}.role`, `must be one of ${AUDIO_ROLES.join(', ')}`)
    return null
  }
  const keyframes = normalizeKeyframeTrackList(raw['keyframes'], `${path}.keyframes`, ctx)
  if (keyframes === null) return null
  const { assetId } = raw as { assetId: string }
  return compact({
    ...raw,
    assetId,
    sourceDurationMs: (raw['sourceDurationMs'] as number | undefined) ?? (raw['durationMs'] as number),
    fadeInMs: (raw['fadeInMs'] as number | undefined) ?? 0,
    fadeOutMs: (raw['fadeOutMs'] as number | undefined) ?? 0,
    keyframes: keyframes.length > 0 ? keyframes : undefined,
  } as StoredAudioTrack)
}

/** Standalone strict export-config validation (used for save payloads). */
export function validateExportConfig(raw: unknown): {
  ok: boolean
  errors: ProjectValidationIssue[]
  warnings: string[]
  data?: CanonicalExportConfig
} {
  const errors: ProjectValidationIssue[] = []
  const warnings: string[] = []
  const ctx: NormalizeContext = { errors, warnings }
  const data = normalizeExportConfig(raw, 'exportConfig', ctx)
  if (data === null) return { ok: false, errors, warnings }
  return { ok: true, errors, warnings, data }
}

/** Strict .clipzu (v2) validation. No defaults, no coercion, no tolerance. */
export function validateClipzuFile(raw: unknown): ClipzuValidationResult {
  const errors: ProjectValidationIssue[] = []
  const warnings: string[] = []
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'project must be a JSON object' }],
      warnings,
    }
  }
  const data: Record<string, unknown> = raw
  if (data['version'] !== CLIPZU_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        {
          path: 'version',
          message: `must be exactly "${CLIPZU_FORMAT_VERSION}", got ${JSON.stringify(data['version'])}`,
        },
      ],
      warnings,
    }
  }
  const ctx: NormalizeContext = { errors, warnings }

  const metadata = data['metadata']
  if (
    !isPlainObject(metadata) ||
    typeof metadata['name'] !== 'string' ||
    metadata['name'].length === 0
  ) {
    issue(errors, 'metadata.name', 'is required and must be a non-empty string')
  }
  const metaFps = isPlainObject(metadata) ? metadata['fps'] : undefined
  if (metaFps !== 24 && metaFps !== 30 && metaFps !== 60) {
    issue(errors, 'metadata.fps', 'must be 24, 30, or 60')
  }
  const metaRes = isPlainObject(metadata) ? metadata['resolution'] : undefined
  if (
    !isPlainObject(metaRes) ||
    !isFiniteNumber(metaRes['width']) ||
    (metaRes['width'] as number) <= 0 ||
    !isFiniteNumber(metaRes['height']) ||
    (metaRes['height'] as number) <= 0
  ) {
    issue(errors, 'metadata.resolution', 'must be { width: number > 0, height: number > 0 }')
  }
  if (
    !isPlainObject(metadata) ||
    typeof metadata['aspectRatio'] !== 'string' ||
    !ASPECT_RATIOS.includes(metadata['aspectRatio'] as string)
  ) {
    issue(errors, 'metadata.aspectRatio', `is required and must be one of ${ASPECT_RATIOS.join(', ')}`)
  }
  if (
    !isPlainObject(metadata) ||
    typeof metadata['backgroundColor'] !== 'string' ||
    (metadata['backgroundColor'] as string).length === 0
  ) {
    issue(errors, 'metadata.backgroundColor', 'is required and must be a non-empty string')
  }

  const seenIds = new Set<string>()
  let assets: AssetRecord[] | null = null
  if (!Array.isArray(data['assets'])) {
    issue(errors, 'assets', 'is required and must be an array')
  } else {
    assets = []
    for (let i = 0; i < (data['assets'] as unknown[]).length; i++) {
      const asset = normalizeAssetRecord((data['assets'] as unknown[])[i], `assets[${i}]`, ctx, seenIds)
      if (asset === null) {
        assets = null
        break
      }
      assets.push(asset)
    }
  }
  const assetIds = new Set<string>(assets?.map((a) => a.id) ?? [])

  const timeline = data['timeline']
  let clips: StoredClip[] | null = null
  let storedAudio: StoredAudioTrack[] | null = null
  let textClips: CanonicalTextClip[] | null = null
  let markers: CanonicalMarker[] | null = null
  if (!isPlainObject(timeline)) {
    issue(errors, 'timeline', 'is required and must be a plain object')
  } else {
    if (!Array.isArray(timeline['clips'])) {
      issue(errors, 'timeline.clips', 'is required and must be an array')
    } else {
      clips = []
      for (let i = 0; i < (timeline['clips'] as unknown[]).length; i++) {
        const clip = normalizeStoredClip((timeline['clips'] as unknown[])[i], `timeline.clips[${i}]`, ctx, assetIds)
        if (clip === null) {
          clips = null
          break
        }
        clips.push(clip)
      }
    }
    if (!Array.isArray(timeline['audioTracks'])) {
      issue(errors, 'timeline.audioTracks', 'is required and must be an array')
    } else {
      storedAudio = []
      for (let i = 0; i < (timeline['audioTracks'] as unknown[]).length; i++) {
        const track = normalizeStoredAudioTrack(
          (timeline['audioTracks'] as unknown[])[i],
          `timeline.audioTracks[${i}]`,
          ctx,
          assetIds
        )
        if (track === null) {
          storedAudio = null
          break
        }
        storedAudio.push(track)
      }
    }
    textClips = normalizeEntityList(timeline['textClips'], 'timeline.textClips', ctx, normalizeTextClip)
    markers = normalizeEntityList(timeline['markers'], 'timeline.markers', ctx, normalizeMarker)
  }

  const tracks = normalizeEntityList(data['tracks'], 'tracks', ctx, normalizeTrack)

  let captions: ClipzuDocument['captions'] | null = null
  const captionsRaw = data['captions']
  if (!isPlainObject(captionsRaw)) {
    issue(errors, 'captions', 'is required and must be a plain object')
  } else {
    const entries = normalizeEntityList(
      captionsRaw['entries'],
      'captions.entries',
      ctx,
      normalizeTextClip
    )
    if (entries === null) {
      captions = null
    } else if (!isPlainObject(captionsRaw['style'])) {
      issue(errors, 'captions.style', 'is required and must be a plain object')
      captions = null
    } else {
      const styleResult = normalizeCaptionStyleFull(captionsRaw['style'], 'captions.style', ctx)
      if (styleResult === null) {
        captions = null
      } else if (typeof captionsRaw['language'] !== 'string' || (captionsRaw['language'] as string).length === 0) {
        issue(errors, 'captions.language', 'is required and must be a non-empty string')
        captions = null
      } else {
        captions = {
          entries,
          style: styleResult,
          language: captionsRaw['language'] as string,
        }
      }
    }
  }
  if (textClips !== null && captions !== null) {
    if (JSON.stringify(textClips) !== JSON.stringify(captions.entries)) {
      issue(errors, 'captions.entries', 'must deep-equal timeline.textClips (copies diverged on disk)')
      captions = null
    }
  }

  let effects: ClipzuDocument['effects'] | null = null
  if (!isPlainObject(data['effects'])) {
    issue(errors, 'effects', 'is required and must be a plain object')
  } else if (data['effects']['modifierSchemaVersion'] !== CURRENT_MODIFIER_VERSION) {
    // Fail closed with an explicit version error: a newer stack version needs
    // a registered migration, never silent reinterpretation.
    issue(
      errors,
      'effects.modifierSchemaVersion',
      `must be ${CURRENT_MODIFIER_VERSION}, got ${JSON.stringify(data['effects']['modifierSchemaVersion'])}`
    )
  } else {
    effects = { modifierSchemaVersion: CURRENT_MODIFIER_VERSION }
  }

  const settings = data['settings']
  if (
    !isPlainObject(settings) ||
    !isFiniteNumber(settings['playheadMs']) ||
    !isFiniteNumber(settings['zoom']) ||
    !isFiniteNumber(settings['masterVolume']) ||
    typeof settings['loopEnabled'] !== 'boolean'
  ) {
    issue(
      errors,
      'settings',
      'is required and must be { playheadMs: number, zoom: number, masterVolume: number, loopEnabled: boolean }'
    )
  }

  const exportConfig = normalizeExportConfig(data['exportConfig'], 'exportConfig', ctx)

  const dependencies = data['dependencies']
  let dependencyAssets: string[] | null = null
  if (!isPlainObject(dependencies)) {
    issue(errors, 'dependencies', 'is required and must be a plain object')
  } else {
    if (
      typeof dependencies['appVersion'] !== 'string' ||
      (dependencies['appVersion'] as string).length === 0
    ) {
      issue(errors, 'dependencies.appVersion', 'is required and must be a non-empty string')
    }
    if (
      !Array.isArray(dependencies['assets']) ||
      !(dependencies['assets'] as unknown[]).every((id) => typeof id === 'string')
    ) {
      issue(errors, 'dependencies.assets', 'is required and must be a string array')
    } else {
      dependencyAssets = (dependencies['assets'] as string[]).slice().sort()
      const manifestIds = Array.from(assetIds).sort()
      if (JSON.stringify(dependencyAssets) !== JSON.stringify(manifestIds)) {
        // Unreferenced manifest entries or dangling references are corruption.
        issue(errors, 'dependencies.assets', 'must exactly equal the manifest asset id set')
        dependencyAssets = null
      }
    }
  }

  // Every stored clip/audio MUST reference a manifest asset (referential
  // integrity — a dangling assetId is never silently dropped).
  if (clips !== null) {
    const referenced = new Set<string>()
    for (const clip of clips) referenced.add(clip.assetId)
    if (storedAudio !== null) {
      for (const track of storedAudio) referenced.add(track.assetId)
    }
    if (assets !== null) {
      for (const asset of assets) {
        if (!referenced.has(asset.id)) {
          issue(errors, `assets[${asset.id}]`, 'is unreferenced by timeline (manifest must match usage exactly)')
        }
      }
    }
  }

  const knownTopLevel = new Set([
    'version', 'metadata', 'assets', 'timeline', 'tracks', 'captions',
    'effects', 'settings', 'exportConfig', 'dependencies',
  ])
  for (const key of Object.keys(data)) {
    if (!knownTopLevel.has(key)) {
      warnings.push(`${key}: unknown top-level field preserved`)
    }
  }

  if (
    errors.length > 0 ||
    assets === null ||
    clips === null ||
    storedAudio === null ||
    textClips === null ||
    markers === null ||
    tracks === null ||
    captions === null ||
    effects === null ||
    !isPlainObject(settings) ||
    exportConfig === null ||
    dependencyAssets === null
  ) {
    return { ok: false, errors, warnings }
  }

  return {
    ok: true,
    errors,
    warnings,
    data: {
      ...data,
      version: CLIPZU_FORMAT_VERSION,
      metadata: {
        name: (metadata as Record<string, unknown>)['name'] as string,
        fps: (metadata as Record<string, unknown>)['fps'] as 24 | 30 | 60,
        resolution: {
          width: (metaRes as { width: number }).width,
          height: (metaRes as { height: number }).height,
        },
        aspectRatio: (metadata as Record<string, unknown>)['aspectRatio'] as string,
        backgroundColor: (metadata as Record<string, unknown>)['backgroundColor'] as string,
      },
      assets,
      timeline: { clips, audioTracks: storedAudio, textClips, markers },
      tracks,
      captions,
      effects,
      settings: {
        playheadMs: (settings as Record<string, unknown>)['playheadMs'] as number,
        zoom: (settings as Record<string, unknown>)['zoom'] as number,
        masterVolume: (settings as Record<string, unknown>)['masterVolume'] as number,
        loopEnabled: (settings as Record<string, unknown>)['loopEnabled'] as boolean,
      },
      exportConfig,
      dependencies: {
        appVersion: (dependencies as Record<string, unknown>)['appVersion'] as string,
        assets: dependencyAssets,
      },
    },
  }
}

export interface V1ToClipzuResult {
  ok: boolean
  errors: ProjectValidationIssue[]
  notes: string[]
  document?: ClipzuDocument
}

/**
 * Strict v1 runtime payload (already validated) -> v2 (.clipzu) migration. Pure.
 * Every unmappable input is an error — nothing invented, nothing dropped
 * silently. proxyPath is DROPPED by design (machine-local cache pointer keyed
 * by the old absolute path hash; guaranteed stale after any move — a
 * regenerable cache, not project state).
 *
 * @param v1 Strict-validated v1 project.
 * @param assets Validated manifest covering EXACTLY the media paths used.
 * @param pathToAssetId Map from normalized absolute media path to asset id.
 * @param appVersion App version string for dependencies provenance.
 * @param exportConfig Full export config supplied by the CALLER (fresh saves
 *   pass the live editor config — production NEVER substitutes defaults).
 */
export function migrateV1ToClipzuStrict(
  v1: NormalizedProjectFile,
  assets: AssetRecord[],
  pathToAssetId: ReadonlyMap<string, string>,
  appVersion: string,
  exportConfig: CanonicalExportConfig,
  notes: string[]
): V1ToClipzuResult {
  const errors: ProjectValidationIssue[] = []
  const assetByPath = new Map<string, AssetRecord>()
  for (const asset of assets) {
    assetByPath.set(normalizeFsPath(asset.originalPath), asset)
  }

  // Usage duration agreement: one file, one intrinsic duration. Disagreement
  // between usages of the same file is corruption, not a rounding choice.
  const durationByPath = new Map<string, number>()
  const usages: Array<{ kind: string; id: string; path: string; sourceDurationMs: number }> = []
  for (const clip of v1.clips) {
    usages.push({ kind: 'clip', id: clip.id, path: clip.path, sourceDurationMs: clip.sourceDurationMs })
  }
  for (const track of v1.audioTracks) {
    usages.push({ kind: 'audioTrack', id: track.id, path: track.path, sourceDurationMs: track.sourceDurationMs })
  }
  for (const usage of usages) {
    const key = normalizeFsPath(usage.path)
    const assetId = pathToAssetId.get(key)
    if (assetId === undefined) {
      errors.push({
        path: `${usage.kind}[${usage.id}]`,
        message: `media path has no manifest asset: ${usage.path}`,
      })
      continue
    }
    const seen = durationByPath.get(key)
    if (seen === undefined) {
      durationByPath.set(key, usage.sourceDurationMs)
    } else if (seen !== usage.sourceDurationMs) {
      errors.push({
        path: `${usage.kind}[${usage.id}]`,
        message: `sourceDurationMs ${usage.sourceDurationMs} disagrees with ${seen} for the same file`,
      })
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors, notes }
  }

  const clips: StoredClip[] = v1.clips.map((clip) => {
    const { path: _path, proxyPath: _proxy, ...rest } = clip as CanonicalClip & {
      path: string
      proxyPath?: string
    }
    void _path
    if (_proxy !== undefined) {
      notes.push(`clip[${clip.id}]: stale proxyPath dropped (machine-local cache, regenerable)`)
    }
    return { ...rest, assetId: pathToAssetId.get(normalizeFsPath(clip.path)) as string }
  })
  const audioTracks: StoredAudioTrack[] = v1.audioTracks.map((track) => {
    const { path: _path, ...rest } = track as CanonicalAudioTrack & { path: string }
    void _path
    return { ...rest, assetId: pathToAssetId.get(normalizeFsPath(track.path)) as string }
  })

  const session = v1 as Record<string, unknown>
  for (const field of ['playheadMs', 'zoom', 'masterVolume', 'loopEnabled'] as const) {
    if (
      (field === 'loopEnabled' && typeof session[field] !== 'boolean') ||
      (field !== 'loopEnabled' && !isFiniteNumber(session[field]))
    ) {
      errors.push({
        path: field,
        message: `is required for v2 settings and must be ${field === 'loopEnabled' ? 'a boolean' : 'a finite number'}`,
      })
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors, notes }
  }

  const manifestIds = assets.map((a) => a.id).sort()
  const document: ClipzuDocument = {
    version: CLIPZU_FORMAT_VERSION,
    metadata: {
      name: v1.name,
      fps: v1.fps,
      resolution: { ...v1.resolution },
      aspectRatio: v1.aspectRatio,
      backgroundColor: v1.backgroundColor,
    },
    assets: assets.slice(),
    timeline: {
      clips,
      audioTracks,
      textClips: v1.textClips.map((tc) => ({ ...tc })),
      markers: v1.markers.map((m) => ({ ...m })),
    },
    tracks: v1.tracks.map((t) => ({ ...t })),
    captions: {
      entries: v1.textClips.map((tc) => ({ ...tc })),
      style: { ...(v1.captions.style as object) } as CaptionStyle,
      language: v1.captions.language,
    },
    effects: { modifierSchemaVersion: CURRENT_MODIFIER_VERSION },
    settings: {
      playheadMs: session['playheadMs'] as number,
      zoom: session['zoom'] as number,
      masterVolume: session['masterVolume'] as number,
      loopEnabled: session['loopEnabled'] as boolean,
    },
    exportConfig: { ...exportConfig },
    dependencies: {
      appVersion,
      assets: manifestIds,
    },
  }
  return { ok: true, errors, notes, document }
}

/** Human-readable one-line summary of validation errors (for IPC errors/toasts). */
export function formatValidationErrors(result: {
  errors: ProjectValidationIssue[]
}): string {
  return result.errors
    .slice(0, 8)
    .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    .join('; ')
}

/**
 * Normalize an absolute path for stable map keys (separators + Unicode).
 * NFC-normalized (Phase 9): macOS yields NFD spellings, Windows NFC — the
 * same file must key identically on both, or asset ids fork per machine.
 */
export function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, '/').normalize('NFC')
}
