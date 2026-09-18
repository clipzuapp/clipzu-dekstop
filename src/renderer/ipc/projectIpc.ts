/**
 * projectIpc.ts — Typed project-persistence IPC call sites (Phase 5).
 *
 * The preload bridge itself stays stringly-typed (it allowlists dozens of
 * channels across every domain); THESE helpers are the typed choke point for
 * project save/load. Payload/result shapes come from shared/ipc/channels so
 * a contract change is a compile error here, not a dead menu item or a
 * mysteriously-null save at runtime. Main still validates `unknown` at the
 * trust boundary — types document intent, validation enforces it.
 */

import {
  PROJECT_SAVE_CHANNEL,
  PROJECT_LOAD_CHANNEL,
  PROJECT_LOAD_PATH_CHANNEL,
  PROJECT_RELINK_LIST_CHANNEL,
  PROJECT_RELINK_LOCATE_CHANNEL,
  PROJECT_RELINK_SCAN_CHANNEL,
  PROJECT_RELINK_RETRY_CHANNEL,
  PROJECT_RELINK_CANCEL_CHANNEL,
  type ProjectSavePayload,
  type ProjectSaveResult,
  type ProjectLoadResult,
} from '../../shared/ipc/channels'
import type { RelinkListResult } from '../../shared/project/relink'

/**
 * Invoke project:save. Resolves to the saved path, or null when the user
 * cancelled the save dialog. Never resolves on failure — main throws, the
 * rejection carries the message, callers must NOT markClean.
 */
export function invokeSaveProject(
  payload: ProjectSavePayload,
  filePath?: string
): Promise<ProjectSaveResult> {
  return window.electron.ipcRenderer.invoke(
    PROJECT_SAVE_CHANNEL,
    payload,
    filePath
  ) as Promise<ProjectSaveResult>
}

/**
 * Invoke project:load (main shows the open dialog). Resolves to the loaded
 * project or null when the user cancelled. Rejects loudly on corruption /
 * missing media — callers must leave current stores untouched.
 */
export function invokeLoadProject(): Promise<ProjectLoadResult | null> {
  return window.electron.ipcRenderer.invoke(
    PROJECT_LOAD_CHANNEL
  ) as Promise<ProjectLoadResult | null>
}

/** Load a known project path (no dialog) — relink retry / recent files. */
export function invokeLoadProjectPath(filePath: string): Promise<ProjectLoadResult> {
  return window.electron.ipcRenderer.invoke(
    PROJECT_LOAD_PATH_CHANNEL,
    filePath
  ) as Promise<ProjectLoadResult>
}

// ---------------------------------------------------------------------------
// Missing-media relink session (token from the failed-load error message)
// ---------------------------------------------------------------------------

export function invokeRelinkList(token: string): Promise<RelinkListResult> {
  return window.electron.ipcRenderer.invoke(
    PROJECT_RELINK_LIST_CHANNEL,
    token
  ) as Promise<RelinkListResult>
}

export function invokeRelinkLocate(token: string, assetId: string): Promise<RelinkListResult> {
  return window.electron.ipcRenderer.invoke(
    PROJECT_RELINK_LOCATE_CHANNEL,
    token,
    assetId
  ) as Promise<RelinkListResult>
}

export function invokeRelinkScan(token: string, folder?: string): Promise<RelinkListResult> {
  return window.electron.ipcRenderer.invoke(
    PROJECT_RELINK_SCAN_CHANNEL,
    token,
    folder
  ) as Promise<RelinkListResult>
}

export function invokeRelinkRetry(token: string): Promise<ProjectLoadResult> {
  return window.electron.ipcRenderer.invoke(
    PROJECT_RELINK_RETRY_CHANNEL,
    token
  ) as Promise<ProjectLoadResult>
}

export function invokeRelinkCancel(token: string): Promise<{ success: boolean }> {
  return window.electron.ipcRenderer.invoke(
    PROJECT_RELINK_CANCEL_CHANNEL,
    token
  ) as Promise<{ success: boolean }>
}
