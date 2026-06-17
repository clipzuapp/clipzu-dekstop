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
}

interface MediaLibraryActions {
  addItem: (item: MediaInfo) => void
  removeItem: (id: string) => void
  setThumbnail: (mediaId: string, base64: string) => void
  removeThumbnail: (mediaId: string) => void
}

export const useMediaLibrary = create<MediaLibraryState & MediaLibraryActions>()(
  immer((set) => ({
    mediaLibrary: [],
    thumbnails: {},

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
      }),

    setThumbnail: (mediaId, base64) =>
      set((state) => {
        state.thumbnails[mediaId] = base64
      }),

    removeThumbnail: (mediaId) =>
      set((state) => {
        delete state.thumbnails[mediaId]
      })
  }))
)
