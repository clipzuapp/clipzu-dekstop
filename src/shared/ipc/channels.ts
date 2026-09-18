/**
 * channels.ts — typed IPC contracts for project persistence + native menu.
 *
 * Phase 5 (task.txt). Single source of truth for channel NAMES consumed by
 * main (send/handle), preload (allowlist), and renderer (invoke/on). A typo
 * in any layer becomes a compile error instead of a dead menu item.
 *
 * Payload discipline:
 * - Renderer→main invoke payloads are TYPED here (what the renderer promises
 *   to send). Main still validates `unknown` at runtime (trust boundary) —
 *   the type documents intent, validation enforces it.
 * - Main→renderer results are TYPED here (what main promises to return).
 *   LoadedProjectFile is canonical (projectSchema); renderer restores from it.
 */

import type { CaptionStyle } from '../types/caption'
import type {
  CanonicalClip,
  CanonicalAudioTrack,
  CanonicalTextClip,
  CanonicalTrack,
  CanonicalMarker,
  CanonicalExportConfig,
  LoadedProjectFile,
} from '../project/projectSchema'

// ---------------------------------------------------------------------------
// Native menu events (main → renderer, via webContents.send / ipcRenderer.on)
// ---------------------------------------------------------------------------
// Named record (order-independent) + derived list for allowlist iteration.
// main/index.ts sends MENU.newProject etc.; preload allowlists MENU_CHANNELS;
// HotkeyManager subscribes to the same names. Any divergence is a compile
// error, not a dead menu item.

export const MENU = {
  newProject: 'menu:new-project',
  openProject: 'menu:open-project',
  save: 'menu:save',
  saveAs: 'menu:save-as',
} as const

export type MenuChannel = (typeof MENU)[keyof typeof MENU]

export const MENU_CHANNELS: readonly MenuChannel[] = [
  MENU.newProject,
  MENU.openProject,
  MENU.save,
  MENU.saveAs,
]

// ---------------------------------------------------------------------------
// Project persistence (renderer → main invoke)
// ---------------------------------------------------------------------------

export const PROJECT_SAVE_CHANNEL = 'project:save' as const
export const PROJECT_LOAD_CHANNEL = 'project:load' as const
/** Load a KNOWN path (relink retry + recent-file flows) — no dialog. */
export const PROJECT_LOAD_PATH_CHANNEL = 'project:loadPath' as const
export const PROJECT_EXPORT_SRT_CHANNEL = 'project:exportSRT' as const
export const PROJECT_CREATE_TEMP_SRT_CHANNEL = 'project:createTempSRT' as const
export const PROJECT_CREATE_TEMP_ASS_CHANNEL = 'project:createTempASS' as const

// Missing-media relink session (token from the failed-load error message).
export const PROJECT_RELINK_LIST_CHANNEL = 'project:relink:list' as const
export const PROJECT_RELINK_LOCATE_CHANNEL = 'project:relink:locate' as const
export const PROJECT_RELINK_SCAN_CHANNEL = 'project:relink:scan' as const
export const PROJECT_RELINK_RETRY_CHANNEL = 'project:relink:retry' as const
export const PROJECT_RELINK_CANCEL_CHANNEL = 'project:relink:cancel' as const

export type ProjectChannel =
  | typeof PROJECT_SAVE_CHANNEL
  | typeof PROJECT_LOAD_CHANNEL
  | typeof PROJECT_LOAD_PATH_CHANNEL
  | typeof PROJECT_EXPORT_SRT_CHANNEL
  | typeof PROJECT_CREATE_TEMP_SRT_CHANNEL
  | typeof PROJECT_CREATE_TEMP_ASS_CHANNEL
  | typeof PROJECT_RELINK_LIST_CHANNEL
  | typeof PROJECT_RELINK_LOCATE_CHANNEL
  | typeof PROJECT_RELINK_SCAN_CHANNEL
  | typeof PROJECT_RELINK_RETRY_CHANNEL
  | typeof PROJECT_RELINK_CANCEL_CHANNEL

/** All project:* invoke channels (preload allowlist + handler registration). */
export const PROJECT_CHANNELS: readonly ProjectChannel[] = [
  PROJECT_SAVE_CHANNEL,
  PROJECT_LOAD_CHANNEL,
  PROJECT_LOAD_PATH_CHANNEL,
  PROJECT_EXPORT_SRT_CHANNEL,
  PROJECT_CREATE_TEMP_SRT_CHANNEL,
  PROJECT_CREATE_TEMP_ASS_CHANNEL,
  PROJECT_RELINK_LIST_CHANNEL,
  PROJECT_RELINK_LOCATE_CHANNEL,
  PROJECT_RELINK_SCAN_CHANNEL,
  PROJECT_RELINK_RETRY_CHANNEL,
  PROJECT_RELINK_CANCEL_CHANNEL,
]

/** Exact payload HotkeyManager.saveProjectToDisk sends (runtime v1 + config). */
export interface ProjectSavePayload {
  version: '1.0'
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
  playheadMs: number
  zoom: number
  masterVolume: number
  loopEnabled: boolean
  captions: {
    entries: CanonicalTextClip[]
    style: CaptionStyle
    language: string
  }
  exportPreset: string
  exportConfig: CanonicalExportConfig
}

export type ProjectSaveResult = string | null

/** Exact result main's project:load returns (null = user cancelled). */
export interface ProjectLoadResult {
  data: LoadedProjectFile
  filePath: string
  /** 'clipzu' = native v2; 'ecp-legacy' = CapCraft-era v1 (toast advises Save to migrate). */
  format: 'clipzu' | 'ecp-legacy'
  migrationNotes: string[]
}
