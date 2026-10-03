import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/**
 * Thumbnail LRU cache — kept OUTSIDE Zustand to avoid React re-renders
 * on every base64 string insertion. The Zustand store holds only a
 * `thumbnailVersion` counter that bumps when any thumbnail changes,
 * allowing components to re-read from this cache without holding the
 * data in React state.
 *
 * Max 500 entries. Oldest-access entries are evicted when full.
 */
const MAX_THUMBNAILS = 500

interface ThumbEntry {
  base64: string
  lastAccess: number
}

const _thumbCache = new Map<string, ThumbEntry>()

export function getThumbnail(mediaId: string): string | undefined {
  const entry = _thumbCache.get(mediaId)
  if (entry) {
    entry.lastAccess = Date.now()
    return entry.base64
  }
  return undefined
}

export function setThumbnailCache(mediaId: string, base64: string): void {
  // Evict LRU if at capacity
  if (_thumbCache.size >= MAX_THUMBNAILS && !_thumbCache.has(mediaId)) {
    let oldestKey: string | null = null
    let oldestAccess = Infinity
    for (const [key, entry] of _thumbCache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess
        oldestKey = key
      }
    }
    if (oldestKey) _thumbCache.delete(oldestKey)
  }
  _thumbCache.set(mediaId, { base64, lastAccess: Date.now() })
}

export function removeThumbnailCache(mediaId: string): void {
  _thumbCache.delete(mediaId)
}

export function clearThumbnailCache(): void {
  _thumbCache.clear()
}

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
  /** Still image (P4): renders/burns from the first frame, no proxy/audio. */
  isImage: boolean
}

interface MediaLibraryState {
  /** Imported media items — library only, NOT timeline clips */
  mediaLibrary: MediaInfo[]
  /** Version counter — bumps when any thumbnail changes (triggers re-render) */
  thumbnailVersion: number
  /** Multi-selection: ordered array of selected media IDs */
  selectedIds: string[]
  /** Search query for filtering media by name */
  searchQuery: string
  /** Filter by media type */
  filterType: 'all' | 'video' | 'audio'
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
  /** Set search query for filtering */
  setSearchQuery: (query: string) => void
  /** Set media type filter */
  setFilterType: (type: 'all' | 'video' | 'audio') => void
  /** Get filtered media library (derived, not stored) */
  getFilteredLibrary: () => MediaInfo[]
}

export const useMediaLibrary = create<MediaLibraryState & MediaLibraryActions>()(
  immer((set, get) => ({
    mediaLibrary: [],
    thumbnailVersion: 0,
    selectedIds: [],
    searchQuery: '',
    filterType: 'all',

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
        removeThumbnailCache(id)
        state.thumbnailVersion++
        state.selectedIds = state.selectedIds.filter((sid) => sid !== id)
      }),

    setThumbnail: (mediaId, base64) => {
      setThumbnailCache(mediaId, base64)
      set((state) => {
        state.thumbnailVersion++
      })
    },

    removeThumbnail: (mediaId) => {
      removeThumbnailCache(mediaId)
      set((state) => {
        state.thumbnailVersion++
      })
    },

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
    },

    setSearchQuery: (query) =>
      set((state) => {
        state.searchQuery = query
      }),

    setFilterType: (type) =>
      set((state) => {
        state.filterType = type
      }),

    getFilteredLibrary: () => {
      const { mediaLibrary, searchQuery, filterType } = get()
      let result = mediaLibrary
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        result = result.filter((m) => m.name.toLowerCase().includes(q))
      }
      if (filterType === 'video') {
        result = result.filter((m) => !m.isAudio)
      } else if (filterType === 'audio') {
        result = result.filter((m) => m.isAudio)
      }
      return result
    }
  }))
)
