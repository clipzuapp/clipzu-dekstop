import { useState, useEffect, useCallback } from 'react'
import { useConfirm } from '../../store/useConfirm'
import { useTimeline } from '../../store/useTimeline'
import { useMediaLibrary, type MediaInfo } from '../../store/useMediaLibrary'
import { ContextMenu } from '../ContextMenu/index'
import { formatDuration } from '../../utils/format'
import type { ContextMenuItem } from '../ContextMenu/index'

/**
 * MediaPanel — production-grade media library (CapCut-style).
 *
 * Features:
 *  - Lazy thumbnail loading for video clips via ffmpeg:getThumbnail IPC
 *  - Local media library: import adds here, NOT to timeline
 *  - HTML5 drag-and-drop: drag FROM library TO timeline to create a clip
 *  - Single unified list: video clips + audio tracks together
 */
export function MediaPanel(): JSX.Element {
  // Media library from Zustand store — survives tab switches
  const mediaLibrary = useMediaLibrary((s) => s.mediaLibrary)
  const thumbnails = useMediaLibrary((s) => s.thumbnails)
  const addToLibrary = useMediaLibrary((s) => s.addItem)
  const removeFromLibrary = useMediaLibrary((s) => s.removeItem)
  const setThumb = useMediaLibrary((s) => s.setThumbnail)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

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

  const handleAddMedia = async (): Promise<void> => {
    const filePaths = await window.electron.ipcRenderer.invoke('ffmpeg:openMediaDialog')
    if (!filePaths || !Array.isArray(filePaths)) return

    for (const path of filePaths) {
      try {
        const info = await window.electron.ipcRenderer.invoke('ffmpeg:getMediaInfo', path)
        const name = path.split(/[\\/]/).pop() || 'Untitled'
        const isAudio = /\.(mp3|wav|aac|ogg|flac|m4a)$/i.test(path)
        const ts = Date.now()
        const rand = Math.random().toString(36).slice(2, 6)

        addToLibrary({
            id: `media_${ts}_${rand}`,
            path,
            name,
            durationMs: info?.durationMs ?? 0,
            width: info?.width,
            height: info?.height,
            hasAudio: info?.hasAudio,
            isAudio
          })
        // DO NOT call useTimeline.addClip here — library only
      } catch (err) {
        console.error('Failed to add media:', err)
      }
    }
  }

  // ---- HTML5 drag-start: carry full media info for timeline drop ----

  const handleDragStart = (e: React.DragEvent, item: MediaInfo): void => {
    e.dataTransfer.setData(
      'application/capcraft-media',
      JSON.stringify({
        path: item.path,
        durationMs: item.durationMs,
        width: item.width ?? 0,
        height: item.height ?? 0,
        hasAudio: item.hasAudio ?? false,
        name: item.name,
        isAudio: item.isAudio
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg1)',
        userSelect: 'none'
      }}
    >
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--text2)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase'
            }}
          >
            Media
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>{mediaLibrary.length} items</span>
        </div>
        <button
          style={{
            width: '100%',
            padding: '6px 0',
            fontSize: '11px',
            fontWeight: 500,
            borderRadius: '4px',
            background: 'rgba(79, 127, 255, 0.12)',
            color: 'var(--accent)',
            border: '1px solid rgba(79, 127, 255, 0.3)',
            cursor: 'pointer',
            transition: 'background 0.15s'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(79, 127, 255, 0.22)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(79, 127, 255, 0.12)')}
          onClick={handleAddMedia}
        >
          + Import Media
        </button>
      </div>

      {/* Media list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {mediaLibrary.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '48px', color: 'var(--text3)' }}>
            <svg
              style={{ width: '40px', height: '40px', margin: '0 auto 8px', opacity: 0.3 }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
            <p style={{ fontSize: '11px', margin: 0 }}>No media imported</p>
            <p style={{ fontSize: '10px', marginTop: '4px', opacity: 0.6 }}>
              Click "+ Import Media" to get started
            </p>
          </div>
        ) : (
          mediaLibrary.map((item) => {
            const thumb = !item.isAudio ? thumbnails[item.id] : null

            return (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setCtxMenu({
                    x: e.clientX, y: e.clientY,
                    items: [
                      { label: 'Add to Timeline at Playhead', onClick: () => {
                        const ts = Date.now()
                        const rand = Math.random().toString(36).slice(2, 6)
                        const ph = useTimeline.getState().playheadMs
                        if (item.isAudio) {
                          useTimeline.getState().addAudioTrack({
                            id: `audio_${ts}_${rand}`,
                            path: item.path,
                            startMs: ph,
                            durationMs: item.durationMs ?? 0,
                            volume: 1,
                            muted: false,
                            name: item.name ?? 'Audio',
                            role: 'music'
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
                            speed: 1.0
                          })
                        }
                      }},
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
                  background: 'var(--bg2)',
                  border: '0.5px solid var(--border)',
                  cursor: 'grab',
                  transition: 'border-color 0.15s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border2)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
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
                    justifyContent: 'center'
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
                          fontSize: '11px',
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
                      fontSize: '11px',
                      color: 'var(--text2)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      margin: 0,
                      lineHeight: '1.4'
                    }}
                  >
                    {item.name}
                  </p>
                  <p style={{ fontSize: '10px', color: 'var(--text3)', margin: 0, lineHeight: '1.3' }}>
                    {formatDuration(item.durationMs)}
                  </p>
                </div>

                {/* Remove from library button */}
                <button
                  style={{
                    color: 'var(--text3)',
                    cursor: 'pointer',
                    background: 'none',
                    border: 'none',
                    padding: '4px',
                    opacity: 0,
                    transition: 'opacity 0.15s, color 0.15s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1'
                    e.currentTarget.style.color = '#f87171'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0'
                    e.currentTarget.style.color = 'var(--text3)'
                  }}
                  onClick={() => handleRemoveFromLibrary(item.id)}
                  title="Remove from library"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5 3V1h6v2h4v1h-1v11a1 1 0 01-1 1H3a1 1 0 01-1-1V4H1V3h4zm1-1h4V2H6v1zM3 4v11h10V4H3zm3 2h1v7H6V6zm4 0h1v7h-1V6z" />
                  </svg>
                </button>
              </div>
            )
          })
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
