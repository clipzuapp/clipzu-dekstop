import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | 'custom'

/** Resolution presets keyed by aspect ratio. [width, height] */
export const RESOLUTION_PRESETS: Record<Exclude<AspectRatio, 'custom'>, [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1':  [1080, 1080],
  '4:5':  [1080, 1350],
  '4:3':  [1440, 1080],
}

/** Snapshot of timeline + caption state for undo/redo */
interface UndoSnapshot {
  clips: import('./useTimeline').Clip[]
  audioTracks: import('./useTimeline').AudioTrack[]
  textClips: import('./useTimeline').TextClip[]
  captions: import('../../shared/utils/srt').CaptionEntry[]
  /** Track lane state (mute, lock, hide, solo, name) */
  tracks?: import('./useTimeline').Track[]
  /** Timeline markers */
  markers?: import('./useTimeline').TimelineMarker[]
}

export interface ProjectState {
  name: string
  fps: 24 | 30 | 60
  resolution: { width: number; height: number }
  aspectRatio: AspectRatio
  /** Canvas background color (CSS color string). Default '#000000'. */
  backgroundColor: string
  projectFilePath: string | null
  isDirty: boolean
  undoStack: UndoSnapshot[]
  redoStack: UndoSnapshot[]
}

export interface ProjectActions {
  setName: (name: string) => void
  setFps: (fps: 24 | 30 | 60) => void
  setResolution: (width: number, height: number) => void
  setAspectRatio: (ratio: AspectRatio) => void
  setBackgroundColor: (color: string) => void
  setProjectFilePath: (path: string | null) => void
  markDirty: () => void
  markClean: () => void
  newProject: () => void
  loadProject: (data: Partial<ProjectState>) => void
  undo: () => UndoSnapshot | null
  redo: () => UndoSnapshot | null
  pushUndo: (snapshot: UndoSnapshot) => void
}

const MAX_UNDO_STACK = 20
/** Max serialized snapshot size (5 MB). Skip if larger to prevent memory blowup. */
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024

const initialState: ProjectState = {
  name: 'Untitled Project',
  fps: 30,
  resolution: { width: 1080, height: 1920 },
  aspectRatio: '9:16',
  backgroundColor: '#000000',
  projectFilePath: null,
  isDirty: false,
  undoStack: [],
  redoStack: [],
}

export const useProject = create<ProjectState & ProjectActions>()(
  immer((set) => ({
    ...initialState,

    setName: (name) =>
      set((state) => {
        state.name = name
        state.isDirty = true
      }),

    setFps: (fps) =>
      set((state) => {
        state.fps = fps
        state.isDirty = true
      }),

    setResolution: (width, height) =>
      set((state) => {
        state.resolution.width = width
        state.resolution.height = height
        state.isDirty = true
      }),

    setAspectRatio: (ratio) =>
      set((state) => {
        state.aspectRatio = ratio
        // Auto-set resolution from preset (skip for 'custom')
        if (ratio !== 'custom') {
          const [w, h] = RESOLUTION_PRESETS[ratio]
          state.resolution.width = w
          state.resolution.height = h
        }
        state.isDirty = true
      }),

    setBackgroundColor: (color) =>
      set((state) => {
        state.backgroundColor = color
        state.isDirty = true
      }),

    setProjectFilePath: (path) =>
      set((state) => {
        state.projectFilePath = path
      }),

    markDirty: () =>
      set((state) => {
        state.isDirty = true
      }),

    markClean: () =>
      set((state) => {
        state.isDirty = false
      }),

    newProject: () =>
      set(() => ({
        ...initialState
      })),

    loadProject: (data) =>
      set((state) => {
        if (data.name !== undefined) state.name = data.name
        if (data.fps !== undefined) state.fps = data.fps
        if (data.resolution) state.resolution = data.resolution
        if (data.aspectRatio) state.aspectRatio = data.aspectRatio
        if (data.backgroundColor !== undefined) state.backgroundColor = data.backgroundColor
        if (data.projectFilePath !== undefined) state.projectFilePath = data.projectFilePath
        state.isDirty = false
        state.undoStack = []
        state.redoStack = []
      }),

    undo: () => {
      const { undoStack } = useProject.getState()
      if (undoStack.length === 0) return null
      const snapshot = undoStack[undoStack.length - 1]
      set((state) => {
        state.undoStack.pop()
        state.redoStack.push(snapshot)
      })
      return snapshot
    },

    redo: () => {
      const { redoStack } = useProject.getState()
      if (redoStack.length === 0) return null
      const snapshot = redoStack[redoStack.length - 1]
      set((state) => {
        state.redoStack.pop()
        state.undoStack.push(snapshot)
      })
      return snapshot
    },

    pushUndo: (snapshot) =>
      set((state) => {
        // Size guard: skip snapshot if too large (prevents OOM on complex projects)
        try {
          const size = JSON.stringify(snapshot).length
          if (size > MAX_SNAPSHOT_BYTES) {
            // Still clear redo and mark dirty, just don't add to undo stack
            state.redoStack = []
            state.isDirty = true
            return
          }
        } catch {
          // If stringify fails (circular ref), skip undo
          return
        }
        state.undoStack.push(snapshot)
        if (state.undoStack.length > MAX_UNDO_STACK) {
          state.undoStack.shift()
        }
        state.redoStack = []
        state.isDirty = true
      })
  }))
)
