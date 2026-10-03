import { create } from 'zustand'
import {
  loadUiPrefs,
  saveUiPrefs,
  toggleCollapseLane,
  defaultStorage,
  type UiPrefs,
} from '../../shared/uiPrefs'

/**
 * useUiPrefs — app-scoped session UI state (Decision D1, Phase 3).
 *
 * zoom memory, audio-lane collapse, panel sizes. Persisted to localStorage
 * (under Electron's userData on disk) on every mutation; NEVER written to
 * `.clipzu` files. Per-project `settings.zoom` still wins on project load
 * (projectSession → loadTimeline applies the file zoom after startup).
 */

interface UiPrefsActions {
  /** Hydrate from storage at app startup. `narrowWindow` seeds the first-run default. */
  hydrate: (narrowWindow: boolean) => void
  /** Collapse/expand one audio lane (persisted; no undo — UI pref, not project state). */
  toggleAudioLane: (trackIndex: number) => void
  /** Persist a resized panel (called on resize-end from page.tsx). */
  setPanelSize: (key: 'mediaPanelW' | 'inspectorW' | 'timelineH', value: number) => void
  /** Persist the global audio-collapse default (no direct UI yet; tested seam). */
  setCollapseAudioByDefault: (value: boolean) => void
}

const EMPTY: UiPrefs = {
  timelineZoom: null,
  collapsedAudioLanes: [],
  expandedAudioLanes: [],
  collapseAudioByDefault: false,
  mediaPanelW: null,
  inspectorW: null,
  timelineH: null,
}

export const useUiPrefs = create<UiPrefs & UiPrefsActions>()((set, get) => ({
  ...EMPTY,

  hydrate: (narrowWindow) => {
    const prefs = loadUiPrefs(defaultStorage(), { narrowWindow })
    set({ ...prefs })
  },

  toggleAudioLane: (trackIndex) => {
    const next = toggleCollapseLane(get(), trackIndex)
    set({
      collapsedAudioLanes: next.collapsedAudioLanes,
      expandedAudioLanes: next.expandedAudioLanes,
    })
    saveUiPrefs({ ...get() }, defaultStorage())
  },

  setPanelSize: (key, value) => {
    set({ [key]: value } as Partial<UiPrefs>)
    saveUiPrefs({ ...get() }, defaultStorage())
  },

  setCollapseAudioByDefault: (value) => {
    set({ collapseAudioByDefault: value })
    saveUiPrefs({ ...get() }, defaultStorage())
  },
}))
