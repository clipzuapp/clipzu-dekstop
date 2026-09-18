import { create } from 'zustand'
import type { ProjectLoadResult } from '../../shared/ipc/channels'
import {
  parseMissingMediaToken,
  type RelinkMissingEntry,
} from '../../shared/project/relink'
import {
  invokeRelinkList,
  invokeRelinkLocate,
  invokeRelinkScan,
  invokeRelinkRetry,
  invokeRelinkCancel,
} from '../ipc/projectIpc'

/**
 * useRelink — missing-media relink dialog state (one-click recovery).
 *
 * Flow: a project:load rejection whose message carries a `MISSING_MEDIA:<token>`
 * marker opens this dialog (openFromError). The user locates files
 * individually or points at a folder to scan; retry reloads the project with
 * the collected overrides. Sessions live in main and are capped there.
 *
 * This store NEVER imports projectSession (that imports this) — applying the
 * reloaded project on retry success is the dialog's job, keeping the
 * dependency graph acyclic.
 */
interface RelinkState {
  open: boolean
  token: string | null
  projectFile: string
  format: 'clipzu' | 'ecp-legacy'
  missing: RelinkMissingEntry[]
  busy: boolean
  error: string | null
  /** Parse a load error; opens + fetches the list. Returns false if unrelated. */
  openFromError: (message: string) => boolean
  locate: (assetId: string) => Promise<void>
  scan: () => Promise<void>
  /** Attempt reload. Resolves to the loaded project, or null (still missing / error). */
  retry: () => Promise<ProjectLoadResult | null>
  cancel: () => Promise<void>
  close: () => void
}

function applyList(
  set: (partial: Partial<RelinkState>) => void,
  list: { projectFile: string; format: 'clipzu' | 'ecp-legacy'; missing: RelinkMissingEntry[] }
): void {
  set({
    projectFile: list.projectFile,
    format: list.format,
    missing: list.missing,
    busy: false,
    error: null,
  })
}

export const useRelink = create<RelinkState>()((set, get) => ({
  open: false,
  token: null,
  projectFile: '',
  format: 'clipzu',
  missing: [],
  busy: false,
  error: null,

  openFromError: (message) => {
    const token = parseMissingMediaToken(message)
    if (!token) return false
    set({ open: true, token, busy: true, error: null, missing: [], projectFile: '' })
    void (async () => {
      try {
        applyList(set, await invokeRelinkList(token))
      } catch (err) {
        set({ busy: false, error: (err as Error).message })
      }
    })()
    return true
  },

  locate: async (assetId) => {
    const { token } = get()
    if (!token) return
    set({ busy: true, error: null })
    try {
      applyList(set, await invokeRelinkLocate(token, assetId))
    } catch (err) {
      set({ busy: false, error: (err as Error).message })
    }
  },

  scan: async () => {
    const { token } = get()
    if (!token) return
    set({ busy: true, error: null })
    try {
      applyList(set, await invokeRelinkScan(token))
    } catch (err) {
      set({ busy: false, error: (err as Error).message })
    }
  },

  retry: async () => {
    const { token } = get()
    if (!token) return null
    set({ busy: true, error: null })
    try {
      const result = await invokeRelinkRetry(token)
      set({ busy: false, open: false, token: null, missing: [], error: null })
      return result
    } catch (err) {
      const message = (err as Error).message
      const refreshed = parseMissingMediaToken(message)
      if (refreshed) {
        // Still missing: refresh the list under the (possibly new) token.
        try {
          const list = await invokeRelinkList(refreshed)
          set({ token: refreshed })
          applyList(set, list)
        } catch (listErr) {
          set({ busy: false, error: (listErr as Error).message })
        }
        return null
      }
      set({ busy: false, error: message })
      return null
    }
  },

  cancel: async () => {
    const { token } = get()
    if (token) {
      try {
        await invokeRelinkCancel(token)
      } catch {
        // Session may already be gone — cancellation is best-effort.
      }
    }
    get().close()
  },

  close: () =>
    set({
      open: false,
      token: null,
      missing: [],
      busy: false,
      error: null,
    }),
}))
