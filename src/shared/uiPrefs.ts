/**
 * uiPrefs.ts — session-UI preferences SSOT (Phase 3, P3.1/P3.3).
 *
 * App-scoped UI state that must NEVER leak into portable `.clipzu` files
 * (Decision D1): timeline zoom memory, audio-lane collapse, panel sizes.
 * Consumed by the renderer (useUiPrefs store, page.tsx startup, Timeline);
 * the save/load pipeline never reads this module (portability guard).
 *
 * Persistence: localStorage (which Electron keeps under the app userData dir
 * on disk, so it survives restarts) with an in-memory fallback. The
 * userData-JSON file fallback from the roadmap is deliberately deferred:
 * it would need a new main-process IPC surface, while localStorage already
 * satisfies "outside the project, survives restart" (see D1 log).
 *
 * Pure module: storage is injected (or resolved via a guarded default), so
 * every function runs under node:test. No DOM at module scope.
 */

// ---------------------------------------------------------------------------
// Zoom policy (P3.3 — single SSOT, replaces x1.5 / x1.33 / x0.75 / 1.15)
// ---------------------------------------------------------------------------

/** The ONE discrete timeline zoom factor. All buttons/tools/keys use this. */
export const ZOOM_STEP = 1.25
/** Hard zoom limits — enforced ONLY by useTimeline.setZoom (single clamp). */
export const ZOOM_MIN = 0.02
export const ZOOM_MAX = 10
/** Smart-default window: fit this much content, then clamp to [0.5, 2]. */
export const SMART_DEFAULT_CONTENT_MS = 60000
export const SMART_DEFAULT_MIN = 0.5
export const SMART_DEFAULT_MAX = 2
/** Narrow-window threshold for default-collapsed audio (13" class). */
export const NARROW_WINDOW_PX = 1400

/** Discrete zoom step, direction-pinned. Clamping stays in setZoom. */
export function applyZoomStep(zoom: number, direction: 'in' | 'out'): number {
  return direction === 'in' ? zoom * ZOOM_STEP : zoom / ZOOM_STEP
}

/**
 * Zoom that fits `contentMs` into `visiblePx` at 0.1 px/ms base scale.
 * Non-positive inputs (empty timeline / zero-width container) → 1.
 * Clamped to [ZOOM_MIN, ZOOM_MAX].
 */
export function zoomToFit(contentMs: number, visiblePx: number): number {
  if (!Number.isFinite(contentMs) || contentMs <= 0) return 1
  if (!Number.isFinite(visiblePx) || visiblePx <= 0) return 1
  const zoom = visiblePx / (0.1 * contentMs)
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom))
}

/**
 * First-session zoom for a window: fit the smart-default content span into
 * the estimated timeline viewport, clamped to [0.5, 2] (roadmap P3.3).
 * STARTUP_CHROME_PX approximates rails/panels/padding; the exact viewport
 * is unknown before first layout, and the clamp absorbs the error.
 */
export const STARTUP_CHROME_PX = 640

export function smartDefaultZoom(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= STARTUP_CHROME_PX) {
    return SMART_DEFAULT_MIN
  }
  const fit = (windowWidth - STARTUP_CHROME_PX) / (0.1 * SMART_DEFAULT_CONTENT_MS)
  return Math.max(SMART_DEFAULT_MIN, Math.min(SMART_DEFAULT_MAX, fit))
}

/**
 * Startup zoom order: remembered session zoom beats the smart default;
 * a saved value outside [ZOOM_MIN, ZOOM_MAX] is treated as absent.
 * Per-project `.clipzu` zoom still wins when a project loads (it applies
 * later via loadTimeline) — this resolver only picks the no-project zoom.
 */
export function resolveStartupZoom(savedZoom: number | null, windowWidth: number): number {
  if (
    savedZoom !== null &&
    Number.isFinite(savedZoom) &&
    savedZoom >= ZOOM_MIN &&
    savedZoom <= ZOOM_MAX
  ) {
    return savedZoom
  }
  return smartDefaultZoom(windowWidth)
}

// ---------------------------------------------------------------------------
// Preferences model + persistence
// ---------------------------------------------------------------------------

export interface UiPrefs {
  /** Last timeline zoom used (null = never recorded). Applied at startup. */
  timelineZoom: number | null
  /** Explicitly collapsed audio lane indices. */
  collapsedAudioLanes: number[]
  /**
   * Explicitly EXPANDED audio lane indices (exclusive with collapsed).
   * Exists so a user re-expand survives `collapseAudioByDefault: true` —
   * without it the global default would re-collapse the lane every load.
   */
  expandedAudioLanes: number[]
  /** First-run default: collapse audio lanes (default-ON under 1400px). */
  collapseAudioByDefault: boolean
  /** Panel sizes in px (null = auto default from window). Persisted on resize. */
  mediaPanelW: number | null
  inspectorW: number | null
  timelineH: number | null
}

export const UI_PREFS_KEY = 'clipzu.uiPrefs.v1'

export const DEFAULT_UI_PREFS: UiPrefs = {
  timelineZoom: null,
  collapsedAudioLanes: [],
  expandedAudioLanes: [],
  collapseAudioByDefault: false,
  mediaPanelW: null,
  inspectorW: null,
  timelineH: null,
}

/** Minimal storage surface (localStorage satisfies it). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

/**
 * Guarded default backend: localStorage when present AND functional, else
 * null. Shape-checked (not just present): Node ships a non-functional
 * placeholder object, and denied storage throws on access — both fall
 * through to null so callers degrade to defaults/session memory.
 * Accessed via globalThis (no DOM lib required — node:test safe).
 */
export function defaultStorage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: Partial<StorageLike> | null }).localStorage
    if (
      ls !== undefined &&
      ls !== null &&
      typeof ls.getItem === 'function' &&
      typeof ls.setItem === 'function'
    ) {
      return ls as StorageLike
    }
  } catch {
    // Cross-origin / disabled storage — fall through to null.
  }
  return null
}

function cleanLaneList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const v of value) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const lane = Math.floor(v)
      if (lane >= 0 && lane < 128 && !out.includes(lane)) out.push(lane)
    }
  }
  return out.sort((a, b) => a - b)
}

function cleanZoom(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < ZOOM_MIN || value > ZOOM_MAX) return null
  return value
}

function cleanPanelSize(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value <= 0 || value > 10000) return null
  return Math.round(value)
}

/**
 * Load + validate + merge over defaults. Corrupt JSON, wrong types, and
 * out-of-range numbers all fall back per-field (never throw, never null).
 * `narrowWindow` seeds the first-run audio default when nothing was saved
 * (pass `window.innerWidth < NARROW_WINDOW_PX` from the renderer).
 */
export function loadUiPrefs(
  storage: StorageLike | null,
  opts?: { narrowWindow?: boolean }
): UiPrefs {
  if (storage === null) return { ...DEFAULT_UI_PREFS }
  let raw: string | null = null
  try {
    raw = storage.getItem(UI_PREFS_KEY)
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
  if (raw === null || raw === '') {
    return {
      ...DEFAULT_UI_PREFS,
      collapseAudioByDefault: opts?.narrowWindow ?? false,
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_UI_PREFS }
  const p = parsed as Record<string, unknown>
  const collapsed = cleanLaneList(p['collapsedAudioLanes'])
  const expanded = cleanLaneList(p['expandedAudioLanes']).filter((l) => !collapsed.includes(l))
  return {
    timelineZoom: cleanZoom(p['timelineZoom']),
    collapsedAudioLanes: collapsed,
    expandedAudioLanes: expanded,
    collapseAudioByDefault:
      typeof p['collapseAudioByDefault'] === 'boolean' ? p['collapseAudioByDefault'] : false,
    mediaPanelW: cleanPanelSize(p['mediaPanelW']),
    inspectorW: cleanPanelSize(p['inspectorW']),
    timelineH: cleanPanelSize(p['timelineH']),
  }
}

/**
 * Validate-then-write. Returns false (no throw) when storage is missing or
 * refuses. Callers persist on every pref mutation; failure just means the
 * next session falls back to defaults.
 */
export function saveUiPrefs(prefs: UiPrefs, storage: StorageLike | null): boolean {
  if (storage === null) return false
  try {
    const clean: UiPrefs = {
      timelineZoom: cleanZoom(prefs.timelineZoom),
      collapsedAudioLanes: cleanLaneList(prefs.collapsedAudioLanes),
      expandedAudioLanes: cleanLaneList(prefs.expandedAudioLanes).filter(
        (l) => !cleanLaneList(prefs.collapsedAudioLanes).includes(l)
      ),
      collapseAudioByDefault: prefs.collapseAudioByDefault === true,
      mediaPanelW: cleanPanelSize(prefs.mediaPanelW),
      inspectorW: cleanPanelSize(prefs.inspectorW),
      timelineH: cleanPanelSize(prefs.timelineH),
    }
    storage.setItem(UI_PREFS_KEY, JSON.stringify(clean))
    return true
  } catch {
    return false
  }
}

/** Record the last-used zoom (read-modify-write; keeps other keys intact). */
export function saveLastZoom(zoom: number, storage: StorageLike | null): boolean {
  if (storage === null) return false
  const clean = cleanZoom(zoom)
  if (clean === null) return false
  const current = loadUiPrefs(storage)
  return saveUiPrefs({ ...current, timelineZoom: clean }, storage)
}

// ---------------------------------------------------------------------------
// Collapse semantics (P3.2)
// ---------------------------------------------------------------------------

/** Minimal audio-collapse prefs (subset of UiPrefs — store-agnostic). */
export interface AudioCollapsePrefs {
  collapsedAudioLanes: readonly number[]
  expandedAudioLanes: readonly number[]
  collapseAudioByDefault: boolean
}

/**
 * Effective collapse for one audio lane: explicit collapse wins, then
 * explicit expand, then the global narrow-window default.
 */
export function isAudioLaneCollapsed(trackIndex: number, prefs: AudioCollapsePrefs): boolean {
  if (prefs.collapsedAudioLanes.includes(trackIndex)) return true
  if (prefs.expandedAudioLanes.includes(trackIndex)) return false
  return prefs.collapseAudioByDefault
}

/**
 * Pure toggle transition (single undo-free UI pref write): collapsing an
 * effectively-collapsed lane explicitly EXPANDS it (and vice versa),
 * maintaining collapsed/expanded exclusivity.
 */
export function toggleCollapseLane(prefs: UiPrefs, trackIndex: number): UiPrefs {
  const lane = Math.max(0, Math.floor(trackIndex))
  const collapsed = new Set(prefs.collapsedAudioLanes)
  const expanded = new Set(prefs.expandedAudioLanes)
  if (isAudioLaneCollapsed(lane, prefs)) {
    collapsed.delete(lane)
    expanded.add(lane)
  } else {
    expanded.delete(lane)
    collapsed.add(lane)
  }
  return {
    ...prefs,
    collapsedAudioLanes: [...collapsed].sort((a, b) => a - b),
    expandedAudioLanes: [...expanded].sort((a, b) => a - b),
  }
}

/** Collapsed lane indices for the first `laneCount` dense audio lanes. */
export function resolveCollapsedAudioLanes(laneCount: number, prefs: AudioCollapsePrefs): number[] {
  const out: number[] = []
  for (let i = 0; i < Math.max(0, Math.floor(laneCount)); i++) {
    if (isAudioLaneCollapsed(i, prefs)) out.push(i)
  }
  return out
}
