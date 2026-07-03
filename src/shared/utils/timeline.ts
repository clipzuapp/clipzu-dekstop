/**
 * timeline.ts — Shared timeline timing utilities (SSOT)
 *
 * Pure functions for duration calculation and TextClip invariants.
 * Safe to import from renderer and main process (no Electron/Node deps).
 */

/** Minimal slice needed to compute timeline end time */
export interface TimelineDurationSlice {
  clips: ReadonlyArray<{ startMs: number; durationMs: number }>
  audioTracks: ReadonlyArray<{ startMs: number; durationMs: number }>
  textClips: ReadonlyArray<{ startMs: number; durationMs: number }>
}

/** Text clip fields involved in start/duration/end invariant */
export interface TextClipTiming {
  startMs: number
  durationMs: number
  endMs: number
  words?: ReadonlyArray<{ word: string; startMs: number; endMs: number }>
  originalWords?: ReadonlyArray<{ word: string; startMs: number; endMs: number }>
  originalStartMs?: number
  originalEndMs?: number
}

export type TextClipTimingPatch = Partial<
  Pick<TextClipTiming, 'startMs' | 'durationMs' | 'endMs'>
>

/**
 * Compute total timeline duration from all track types.
 * Returns 0 when the timeline is empty.
 */
export function recalcTimelineDuration(state: TimelineDurationSlice): number {
  let max = 0
  for (const c of state.clips) {
    max = Math.max(max, c.startMs + c.durationMs)
  }
  for (const a of state.audioTracks) {
    max = Math.max(max, a.startMs + a.durationMs)
  }
  for (const t of state.textClips) {
    max = Math.max(max, t.startMs + t.durationMs)
  }
  return max
}

/** Derived end time — prefer this over reading stored endMs when possible */
export function getTextClipEnd(tc: Pick<TextClipTiming, 'startMs' | 'durationMs'>): number {
  return tc.startMs + tc.durationMs
}

/** Enforce endMs = startMs + durationMs */
export function normalizeTextClip<T extends TextClipTiming>(tc: T): T {
  tc.endMs = getTextClipEnd(tc)
  return tc
}

/** Shift text clip start by deltaMs; duration unchanged */
export function shiftTextClipStart<T extends TextClipTiming>(tc: T, deltaMs: number): T {
  tc.startMs += deltaMs
  return normalizeTextClip(tc)
}

/**
 * Apply partial updates to a TextClip while preserving timing invariants.
 * endMs in updates is accepted as input but always recomputed from startMs + durationMs.
 */
export function applyTextClipMutations(
  clip: TextClipTiming,
  updates: TextClipTimingPatch,
  options?: { preserveTrimOriginals?: boolean }
): void {
  const { preserveTrimOriginals = true } = options ?? {}

  if (preserveTrimOriginals) {
    const isTrim =
      updates.startMs !== undefined ||
      updates.endMs !== undefined ||
      updates.durationMs !== undefined
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
  }

  const patch: TextClipTimingPatch = { ...updates }

  if (patch.endMs !== undefined && patch.durationMs === undefined) {
    const start = patch.startMs ?? clip.startMs
    patch.durationMs = patch.endMs - start
  }
  if (
    patch.startMs !== undefined &&
    patch.endMs !== undefined &&
    patch.durationMs === undefined
  ) {
    patch.durationMs = patch.endMs - patch.startMs
  }

  delete patch.endMs

  if (patch.startMs !== undefined) clip.startMs = patch.startMs
  if (patch.durationMs !== undefined) clip.durationMs = Math.max(0, patch.durationMs)

  normalizeTextClip(clip)
}
