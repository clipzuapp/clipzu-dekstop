import { useState, useEffect, useCallback, useRef } from 'react'
import { useConfirm } from '../../store/useConfirm'
import { useTimeline } from '../../store/useTimeline'
import { useMediaLibrary, type MediaInfo } from '../../store/useMediaLibrary'
import { useToast } from '../../store/useToast'
import { ContextMenu } from '../ContextMenu/index'
import { formatDuration } from '../../utils/format'
import type { ContextMenuItem } from '../ContextMenu/index'
import { Trash2, Check } from 'lucide-react'

/** Media file extensions we accept for drag-and-drop import */
const MEDIA_EXTS = /\.(mp4|mov|avi|mkv|webm|mp3|wav|aac|ogg|flac|m4a)$/i

/**
 * MediaPanel — production-grade media library (CapCut-style).
 *
 * Features:
 *  - Lazy thumbnail loading for video clips via ffmpeg:getThumbnail IPC
 *  - Local media library: import adds here, NOT to timeline
 *  - HTML5 drag-and-drop: drag FROM library TO timeline to create clips
 *  - Drag-and-drop IMPORT: drop files from OS file explorer onto the panel
 *  - Multi-select: Ctrl/Cmd+click to toggle, drag selected batch to timeline
 *  - Interactive depth: hover lift, selection glow, spring transitions
 */
export function MediaPanel(): JSX.Element {
  const mediaLibrary = useMediaLibrary((s) => s.mediaLibrary)
  const thumbnails = useMediaLibrary((s) => s.thumbnails)
  const selectedIds = useMediaLibrary((s) => s.selectedIds)
  const addToLibrary = useMediaLibrary((s) => s.addItem)
  const removeFromLibrary = useMediaLibrary((s) => s.removeItem)
  const setThumb = useMediaLibrary((s) => s.setThumbnail)
  const toggleSelect = useMediaLibrary((s) => s.toggleSelect)
  const deselectAll = useMediaLibrary((s) => s.deselectAll)

  const selectedSet = new Set(selectedIds)
  const selectedCount = selectedIds.length

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  // Drag-and-drop import state
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  // Marquee (click-drag) selection state
  const [marqueeBox, setMarqueeBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const marqueeRef = useRef<{
    active: boolean
    startX: number
    startY: number
    moved: boolean
    containerRect: DOMRect | null
  }>({ active: false, startX: 0, startY: 0, moved: false, containerRect: null })
  const mediaListRef = useRef<HTMLDivElement>(null)

  // Load thumbnail for a single video item
  const loadThumbnail = useCallback(async (id: string, path: string) => {
    try {
      const base64 = await window.electron.ipcRenderer.invoke(
        'ffmpeg:getThumbnail', path, 0, 120
      )
      if (base64 && typeof base64 === 'string') {
        setThumb(id, base64)
      }
    } catch {
      // Thumbnail loading is best-effort — don't break the UI
    }
  }, [setThumb])

  // Load thumbnails whenever the library changes
  useEffect(() => {
    mediaLibrary.forEach((item) => {
      if (!thumbnails[item.id] && !item.isAudio) {
        loadThumbnail(item.id, item.path)
      }
    })
  }, [mediaLibrary, thumbnails, loadThumbnail])

  // ---- Import media (adds to library ONLY, not timeline) ----
  
  /** Process an array of file paths: get media info and add to library */
  const importFilePaths = useCallback(async (paths: string[]) => {
    for (const p of paths) {
      try {
        const info = await window.electron.ipcRenderer.invoke('ffmpeg:getMediaInfo', p)
        const name = p.split(/[\\/]/).pop() || 'Untitled'
        const isAudio = /\.(mp3|wav|aac|ogg|flac|m4a)$/i.test(p)
        const ts = Date.now()
        const rand = Math.random().toString(36).slice(2, 6)
  
        addToLibrary({
          id: `media_${ts}_${rand}`,
          path: p,
          name,
          durationMs: info?.durationMs ?? 0,
          width: info?.width,
          height: info?.height,
          hasAudio: info?.hasAudio,
          isAudio
        })
      } catch (err) {
        console.error('Failed to add media:', err)
        useToast.getState().error(`Failed to add media: ${(err as Error).message}`)
      }
    }
  }, [addToLibrary])
  
  const handleAddMedia = async (): Promise<void> => {
    const filePaths = await window.electron.ipcRenderer.invoke('ffmpeg:openMediaDialog')
    if (!filePaths || !Array.isArray(filePaths)) return
    await importFilePaths(filePaths as string[])
  }
  
  // ---- Drag-and-drop IMPORT from OS file explorer ----
  
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    // Only react to external file drops (Files type), not internal media drags
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      dragCounterRef.current++
      setIsDragOver(true)
    }
  }, [])
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      dragCounterRef.current--
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0
        setIsDragOver(false)
      }
    }
  }, [])
  
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)
  
    // Guard: only process external file drops
    if (!e.dataTransfer.types.includes('Files')) return
  
    const files = Array.from(e.dataTransfer.files)
    const validPaths = files
      .filter((f) => MEDIA_EXTS.test(f.name))
      .map((f) => (f as unknown as { path: string }).path)
      .filter(Boolean)
  
    if (validPaths.length === 0) {
      useToast.getState().error('No supported media files found. Accepted: mp4, mov, avi, mkv, webm, mp3, wav, aac, ogg, flac, m4a')
      return
    }
  
    await importFilePaths(validPaths)
  }, [importFilePaths])

  // ---- HTML5 drag-start: carry ALL selected items for timeline batch drop ----

  const handleDragStart = useCallback((e: React.DragEvent, item: MediaInfo) => {
    // Determine which items to drag: selected items (if current is in selection) or just this one
    const dragItems = selectedSet.has(item.id)
      ? mediaLibrary.filter((m) => selectedSet.has(m.id))
      : [item]

    // Batch format: array of media objects for the timeline drop handler
    e.dataTransfer.setData(
      'application/capcraft-media-batch',
      JSON.stringify(dragItems.map((m) => ({
        path: m.path,
        durationMs: m.durationMs,
        width: m.width ?? 0,
        height: m.height ?? 0,
        hasAudio: m.hasAudio ?? true,
        name: m.name,
        isAudio: m.isAudio
      })))
    )
    // Also set single-item format for backward compatibility
    e.dataTransfer.setData(
      'application/capcraft-media',
      JSON.stringify({
        path: item.path,
        durationMs: item.durationMs,
        width: item.width ?? 0,
        height: item.height ?? 0,
        hasAudio: item.hasAudio ?? true,
        name: item.name,
        isAudio: item.isAudio
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }, [mediaLibrary, selectedSet])

  // ---- Click handler with multi-select support ----

  const handleItemClick = useCallback((e: React.MouseEvent, itemId: string) => {
    const multi = e.ctrlKey || e.metaKey
    toggleSelect(itemId, multi)
  }, [toggleSelect])

  // ---- Marquee (click-drag) selection ----

  const handleListMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start marquee on left-click on the container background (not on items)
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const container = mediaListRef.current
    if (!container || target !== container) return

    e.preventDefault()
    const rect = container.getBoundingClientRect()
    marqueeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      containerRect: rect
    }

    const onMouseMove = (ev: MouseEvent): void => {
      const m = marqueeRef.current
      if (!m.active) return
      const dx = Math.abs(ev.clientX - m.startX)
      const dy = Math.abs(ev.clientY - m.startY)
      if (dx > 3 || dy > 3) m.moved = true
      if (!m.moved) return

      const rect = m.containerRect!
      const x = Math.max(0, Math.min(m.startX, ev.clientX) - rect.left)
      const y = Math.max(0, Math.min(m.startY, ev.clientY) - rect.top)
      const w = Math.min(rect.width - x, Math.abs(ev.clientX - m.startX))
      const h = Math.min(rect.height - y, Math.abs(ev.clientY - m.startY))
      setMarqueeBox({ x, y, w, h })

      // Live-select items inside the box
      const items = container.querySelectorAll<HTMLElement>('[data-media-id]')
      const boxLeft = rect.left + x
      const boxTop = rect.top + y
      const boxRight = boxLeft + w
      const boxBottom = boxTop + h
      const idsInBox: string[] = []
      items.forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.right > boxLeft && r.left < boxRight && r.bottom > boxTop && r.top < boxBottom) {
          const id = el.getAttribute('data-media-id')
          if (id) idsInBox.push(id)
        }
      })

      // Replace selection with items in box (unless Ctrl held)
      const store = useMediaLibrary.getState()
      if (ev.ctrlKey || ev.metaKey) {
        // Add to existing selection
        const existing = new Set(store.selectedIds)
        idsInBox.forEach((id) => existing.add(id))
        useMediaLibrary.setState({ selectedIds: [...existing] })
      } else {
        useMediaLibrary.setState({ selectedIds: idsInBox })
      }
    }

    const onMouseUp = (): void => {
      marqueeRef.current.active = false
      setMarqueeBox(null)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  // ---- Remove from library ----

  const handleRemoveFromLibrary = (id: string): void => {
    const item = mediaLibrary.find((m) => m.id === id)
    useConfirm.getState().show({
      title: 'Remove from Library',
      message: `Remove "${item?.name || 'item'}" from the media library?`,
      variant: 'danger',
      confirmLabel: 'Remove'
    }).then((confirmed) => {
      if (!confirmed) return
      removeFromLibrary(id)
    })
  }

  // ---- Remove selected ----

  const handleRemoveSelected = (): void => {
    if (selectedCount === 0) return
    useConfirm.getState().show({
      title: 'Remove Selected',
      message: `Remove ${selectedCount} item${selectedCount > 1 ? 's' : ''} from the media library?`,
      variant: 'danger',
      confirmLabel: 'Remove'
    }).then((confirmed) => {
      if (!confirmed) return
      for (const id of [...selectedIds]) {
        removeFromLibrary(id)
      }
    })
  }

  // ---- Keyboard shortcuts are handled globally by HotkeyManager ----
  // (Ctrl+A select-all and Escape deselect are centralized to avoid conflicts)

  // ---- Add single item to timeline (context menu action) ----

  const addSingleToTimeline = useCallback((item: MediaInfo) => {
    const ts = Date.now()
    const rand = Math.random().toString(36).slice(2, 6)
    const ph = useTimeline.getState().playheadMs
    if (item.isAudio) {
      useTimeline.getState().addAudioTrack({
        id: `audio_${ts}_${rand}`,
        path: item.path,
        startMs: ph,
        sourceDurationMs: item.durationMs ?? 0,
        durationMs: item.durationMs ?? 0,
        volume: 1,
        muted: false,
        name: item.name ?? 'Audio',
        role: 'music',
        trimStart: 0,
        trimEnd: 0,
        trackIndex: 0
      })
    } else {
      useTimeline.getState().addClip({
        id: `clip_${ts}_${rand}`,
        path: item.path,
        startMs: ph,
        sourceDurationMs: item.durationMs ?? 0,
        durationMs: item.durationMs ?? 0,
        trackIndex: 0,
        trimStart: 0,
        trimEnd: 0,
        name: item.name ?? 'Clip',
        hasAudio: item.hasAudio ?? true,
        speed: 1.0,
        volume: 1,
        muted: false
      })
    }
  }, [])

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: isDragOver ? 'rgba(79, 127, 255, 0.06)' : 'var(--bg1)',
        userSelect: 'none',
        position: 'relative',
        transition: 'background 0.2s ease'
      }}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(79, 127, 255, 0.08)',
            border: '2px dashed var(--accent)',
            borderRadius: '6px',
            pointerEvents: 'none'
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <svg
              style={{ width: '32px', height: '32px', margin: '0 auto 6px', color: 'var(--accent)', opacity: 0.8 }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p style={{ fontSize: '12px', color: 'var(--accent)', margin: 0, fontWeight: 500 }}>
              Drop media files here
            </p>
          </div>
        </div>
      )}
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--text2)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase'
            }}
          >
            Media
          </span>
          {selectedCount > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--accent)' }}>{selectedCount} selected</span>
              <button
                onClick={deselectAll}
                style={{
                  fontSize: '11px',
                  color: 'var(--text3)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 6px'
                }}
              >
                Deselect
              </button>
              <button
                onClick={handleRemoveSelected}
                style={{
                  fontSize: '11px',
                  color: '#f87171',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 6px'
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--text3)' }}>{mediaLibrary.length} items</span>
          )}
        </div>
        <button
          style={{
            width: '100%',
            padding: '6px 0',
            fontSize: '13px',
            fontWeight: 500,
            borderRadius: '4px',
            background: 'rgba(79, 127, 255, 0.12)',
            color: 'var(--accent)',
            border: '1px solid rgba(79, 127, 255, 0.3)',
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.25, 1.1, 0.5, 1)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(79, 127, 255, 0.22)'
            e.currentTarget.style.transform = 'translateY(-1px)'
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(79, 127, 255, 0.12)'
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = 'none'
          }}
          onClick={handleAddMedia}
        >
          + Import Media
        </button>
      </div>

      {/* Media list */}
      <div
        ref={mediaListRef}
        onMouseDown={handleListMouseDown}
        style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}
      >
        {mediaLibrary.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '48px', color: 'var(--text3)' }}>
            <svg
              style={{ width: '40px', height: '40px', margin: '0 auto 8px', opacity: 0.3 }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
            <p style={{ fontSize: '12px', margin: 0 }}>No media imported</p>
            <p style={{ fontSize: '11px', marginTop: '4px', opacity: 0.6 }}>
              Click "+" or drop files here to get started
            </p>
          </div>
        ) : (
          mediaLibrary.map((item) => {
            const thumb = !item.isAudio ? thumbnails[item.id] : null
            const isSelected = selectedSet.has(item.id)

            return (
              <div
                key={item.id}
                data-media-id={item.id}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onClick={(e) => handleItemClick(e, item.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCtxMenu({
                    x: e.clientX, y: e.clientY,
                    items: [
                      { label: 'Add to Timeline at Playhead', onClick: () => addSingleToTimeline(item) },
                      { divider: true },
                      { label: 'Delete from Library', danger: true, onClick: () => handleRemoveFromLibrary(item.id) },
                      { label: 'Reveal in Folder', disabled: true }
                    ]
                  })
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '7px 8px',
                  borderRadius: '4px',
                  background: isSelected ? 'rgba(79, 127, 255, 0.12)' : 'var(--bg2)',
                  border: isSelected
                    ? '1px solid rgba(79, 127, 255, 0.45)'
                    : '0.5px solid var(--border)',
                  boxShadow: isSelected
                    ? '0 0 6px rgba(79, 127, 255, 0.15)'
                    : '0 1px 2px rgba(0, 0, 0, 0.25)',
                  cursor: 'grab',
                  transition: 'all 0.2s cubic-bezier(0.25, 1.1, 0.5, 1)',
                  position: 'relative' as const
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'var(--border2)'
                  }
                  e.currentTarget.style.transform = 'translateY(-1px)'
                  e.currentTarget.style.boxShadow = isSelected
                    ? '0 2px 10px rgba(79, 127, 255, 0.25)'
                    : '0 3px 10px rgba(0, 0, 0, 0.35)'
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = 'var(--border)'
                  }
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = isSelected
                    ? '0 0 6px rgba(79, 127, 255, 0.15)'
                    : '0 1px 2px rgba(0, 0, 0, 0.25)'
                }}
              >
                {/* Thumbnail or kind badge */}
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '4px',
                    flexShrink: 0,
                    overflow: 'hidden',
                    background: 'rgba(0,0,0,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'transform 0.2s cubic-bezier(0.25, 1.1, 0.5, 1)',
                    transform: isSelected ? 'scale(1.05)' : 'scale(1)'
                  }}
                >
                  {thumb ? (
                    <img
                      src={`data:image/png;base64,${thumb}`}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: item.isAudio ? 'rgba(74, 222, 128, 0.15)' : 'rgba(79, 127, 255, 0.15)'
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 700,
                          color: item.isAudio ? '#4ade80' : 'var(--accent)'
                        }}
                      >
                        {item.isAudio ? 'A' : 'V'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: '12px',
                      color: isSelected ? 'var(--accent)' : 'var(--text2)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      margin: 0,
                      lineHeight: '1.4',
                      fontWeight: isSelected ? 500 : 400
                    }}
                  >
                    {item.name}
                  </p>
                  <p style={{ fontSize: '11px', color: 'var(--text3)', margin: 0, lineHeight: '1.3' }}>
                    {formatDuration(item.durationMs)}
                  </p>
                </div>

                {/* Selection check or remove button */}
                {isSelected ? (
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <Check size={12} color="#fff" strokeWidth={3} />
                  </div>
                ) : (
                  <button
                    style={{
                      color: 'var(--text3)',
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      opacity: 0,
                      transition: 'opacity 0.2s, color 0.2s',
                      flexShrink: 0
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1'
                      e.currentTarget.style.color = '#f87171'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0'
                      e.currentTarget.style.color = 'var(--text3)'
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveFromLibrary(item.id)
                    }}
                    title="Remove from library"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )
          })
        )}

        {/* Marquee selection overlay (positioned relative to this container) */}
        {marqueeBox && (
          <div
            style={{
              position: 'absolute',
              left: marqueeBox.x,
              top: marqueeBox.y,
              width: marqueeBox.w,
              height: marqueeBox.h,
              background: 'rgba(79, 127, 255, 0.12)',
              border: '1px solid rgba(79, 127, 255, 0.5)',
              borderRadius: '2px',
              pointerEvents: 'none',
              zIndex: 50
            }}
          />
        )}
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          items={ctxMenu.items}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}

export default MediaPanel
