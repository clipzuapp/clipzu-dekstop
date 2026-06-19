import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/**
 * usePreviewView — Ephemeral preview viewport state.
 * NOT persisted in project files. NOT in undo stack.
 * Owns: zoom mode, pan, guide overlays, render quality, playback speed, fullscreen.
 */

export type ZoomMode = 'fit' | 'fill' | number
export type GridMode = 'none' | 'thirds' | 'center'
export type QualityMode = 'full' | 'half' | 'quarter'

export const ZOOM_PRESETS: number[] = [25, 50, 100, 200, 400]
export const SPEED_PRESETS: number[] = [0.25, 0.5, 1, 1.5, 2]

export interface PreviewViewState {
  zoomMode: ZoomMode
  panX: number
  panY: number
  guides: {
    titleSafe: boolean
    actionSafe: boolean
    grid: GridMode
  }
  quality: QualityMode
  playbackSpeed: number
  isFullscreen: boolean
}

export interface PreviewViewActions {
  setZoomMode: (mode: ZoomMode) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setPan: (x: number, y: number) => void
  adjustPan: (dx: number, dy: number) => void
  resetPan: () => void
  toggleGuide: (guide: 'titleSafe' | 'actionSafe') => void
  cycleGrid: () => void
  setGrid: (grid: GridMode) => void
  setQuality: (q: QualityMode) => void
  setPlaybackSpeed: (speed: number) => void
  toggleFullscreen: () => void
}

const initialState: PreviewViewState = {
  zoomMode: 'fit',
  panX: 0,
  panY: 0,
  guides: { titleSafe: false, actionSafe: false, grid: 'none' },
  quality: 'full',
  playbackSpeed: 1,
  isFullscreen: false,
}

const GRID_CYCLE: GridMode[] = ['none', 'thirds', 'center']

export const usePreviewView = create<PreviewViewState & PreviewViewActions>()(
  immer((set) => ({
    ...initialState,

    setZoomMode: (mode) =>
      set((state) => {
        state.zoomMode = mode
        // Reset pan when switching to fit/fill
        if (mode === 'fit' || mode === 'fill') {
          state.panX = 0
          state.panY = 0
        }
      }),

    zoomIn: () =>
      set((state) => {
        const current = typeof state.zoomMode === 'number' ? state.zoomMode : 100
        const next = ZOOM_PRESETS.find((p) => p > current) ?? ZOOM_PRESETS[ZOOM_PRESETS.length - 1]
        state.zoomMode = next
      }),

    zoomOut: () =>
      set((state) => {
        const current = typeof state.zoomMode === 'number' ? state.zoomMode : 100
        const prev = [...ZOOM_PRESETS].reverse().find((p) => p < current) ?? ZOOM_PRESETS[0]
        state.zoomMode = prev
      }),

    resetZoom: () =>
      set((state) => {
        state.zoomMode = 'fit'
        state.panX = 0
        state.panY = 0
      }),

    setPan: (x, y) =>
      set((state) => {
        state.panX = x
        state.panY = y
      }),

    adjustPan: (dx, dy) =>
      set((state) => {
        state.panX += dx
        state.panY += dy
      }),

    resetPan: () =>
      set((state) => {
        state.panX = 0
        state.panY = 0
      }),

    toggleGuide: (guide) =>
      set((state) => {
        state.guides[guide] = !state.guides[guide]
      }),

    cycleGrid: () =>
      set((state) => {
        const idx = GRID_CYCLE.indexOf(state.guides.grid)
        state.guides.grid = GRID_CYCLE[(idx + 1) % GRID_CYCLE.length]
      }),

    setGrid: (grid) =>
      set((state) => {
        state.guides.grid = grid
      }),

    setQuality: (q) =>
      set((state) => {
        state.quality = q
      }),

    setPlaybackSpeed: (speed) =>
      set((state) => {
        state.playbackSpeed = speed
      }),

    toggleFullscreen: () =>
      set((state) => {
        state.isFullscreen = !state.isFullscreen
      }),
  }))
)
