import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/**
 * MediaInfo — one imported media item in the local library.
 * Lives in Zustand store so it survives tab switches.
 */
export interface MediaInfo {
  id: string
  path: string
  name: string
  durationMs: number
  width?: number
  height?: number
  hasAudio?: boolean
  isAudio: boolean
}

interface MediaLibraryState {
  /** Imported media items — library only, NOT timeline clips */
  mediaLibrary: MediaInfo[]
  /** Lazy-loaded thumbnails: mediaId → base64 PNG string */
  thumbnails: Record<string, string>
  /** Multi-selection: ordered array of selected media IDs */
  selectedIds: string[]
}

interface MediaLibraryActions {
  addItem: (item: MediaInfo) => void
  removeItem: (id: string) => void
  setThumbnail: (mediaId: string, base64: string) => void
  removeThumbnail: (mediaId: string) => void
  /** Toggle selection for a media item. If multi is true, adds to existing selection (Ctrl/Cmd click). */
  toggleSelect: (id: string, multi?: boolean) => void
  /** Select all items in the library */
  selectAll: () => void
  /** Clear all selections */
  deselectAll: () => void
  /** Check if a media item is selected */
  isSelected: (id: string) => boolean
}

export const useMediaLibrary = create<MediaLibraryState & MediaLibraryActions>()(
  immer((set, get) => ({
    mediaLibrary: [],
    thumbnails: {},
    selectedIds: [],

    addItem: (item) =>
      set((state) => {
        // Deduplicate by path
        if (!state.mediaLibrary.some((m) => m.path === item.path)) {
          state.mediaLibrary.push(item)
        }
      }),

    removeItem: (id) =>
      set((state) => {
        state.mediaLibrary = state.mediaLibrary.filter((item) => item.id !== id)
        delete state.thumbnails[id]
        state.selectedIds = state.selectedIds.filter((sid) => sid !== id)
      }),

    setThumbnail: (mediaId, base64) =>
      set((state) => {
        state.thumbnails[mediaId] = base64
      }),

    removeThumbnail: (mediaId) =>
      set((state) => {
        delete state.thumbnails[mediaId]
      }),

    toggleSelect: (id, multi) =>
      set((state) => {
        if (!multi) {
          // Single select — replace entire selection
          if (state.selectedIds.length === 1 && state.selectedIds[0] === id) {
            state.selectedIds = []
          } else {
            state.selectedIds = [id]
          }
        } else {
          // Multi-select (Ctrl/Cmd) — toggle
          const idx = state.selectedIds.indexOf(id)
          if (idx >= 0) {
            state.selectedIds.splice(idx, 1)
          } else {
            state.selectedIds.push(id)
          }
        }
      }),

    selectAll: () =>
      set((state) => {
        state.selectedIds = state.mediaLibrary.map((m) => m.id)
      }),

    deselectAll: () =>
      set((state) => {
        state.selectedIds = []
      }),

    isSelected: (id) => {
      return get().selectedIds.includes(id)
    }
  }))
)
