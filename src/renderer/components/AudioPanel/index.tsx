import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '../../store/useToast'
import { formatDuration } from '../../utils/format'

/**
 * AudioPanel — Sound Effects Browser (CapCut-style).
 * 
 * Features:
 *  - Displays all SFX files from assets/sfx folder
 *  - Groups by category (click, cheer, clap, etc.)
 *  - HTML5 drag-and-drop: drag FROM panel TO timeline to add audio track
 *  - Preview playback on click
 *  - Search/filter functionality
 */

interface SFXFile {
  id: string
  name: string
  path: string
  size: number
  category: string
  durationMs: number
}

export function AudioPanel(): JSX.Element {
  const [sfxLibrary, setSfxLibrary] = useState<SFXFile[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Load SFX library from main process
  useEffect(() => {
    const loadLibrary = async () => {
      try {
        setLoading(true)
        const files = await window.electron.ipcRenderer.invoke('sfx:getLibrary')
        setSfxLibrary(files as SFXFile[])
      } catch (error) {
        console.error('[AudioPanel] Failed to load SFX library:', error)
        useToast.getState().error('Failed to load sound effects')
      } finally {
        setLoading(false)
      }
    }
    loadLibrary()
  }, [])

  // Filter SFX by search query
  const filteredSFX = searchQuery
    ? sfxLibrary.filter(sfx => 
        sfx.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sfx.category.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sfxLibrary

  // Group by category
  const groupedByCategory = filteredSFX.reduce<Record<string, SFXFile[]>>((acc, sfx) => {
    if (!acc[sfx.category]) {
      acc[sfx.category] = []
    }
    acc[sfx.category].push(sfx)
    return acc
  }, {})

  // Preview audio on click
  const handlePreview = useCallback(async (sfx: SFXFile) => {
    // Stop any currently playing preview
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    if (previewingId === sfx.id) {
      // Same file clicked again - just stop
      setPreviewingId(null)
      return
    }

    // Play new file
    setPreviewingId(sfx.id)
    const audio = new Audio(`file://${sfx.path}`)
    audioRef.current = audio
    
    audio.onended = () => {
      setPreviewingId(null)
      audioRef.current = null
    }

    audio.onerror = () => {
      setPreviewingId(null)
      audioRef.current = null
      useToast.getState().error('Failed to play audio')
    }

    await audio.play()
  }, [previewingId])

  // HTML5 drag-start: carry full SFX info for timeline drop
  const handleDragStart = (e: React.DragEvent, sfx: SFXFile): void => {
    e.dataTransfer.setData(
      'application/capcraft-media',
      JSON.stringify({
        path: sfx.path,
        durationMs: sfx.durationMs,
        width: 0,
        height: 0,
        hasAudio: true,
        name: sfx.name,
        isAudio: true,
        isSfx: true
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

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
            Sound Effects
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text3)' }}>
            {filteredSFX.length} sounds
          </span>
        </div>

        {/* Search input */}
        <input
          type="text"
          placeholder="Search sound effects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: '11px',
            borderRadius: '4px',
            background: 'var(--bg2)',
            border: '0.5px solid var(--border)',
            color: 'var(--text2)',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* SFX list */}
      <div className="inspector-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: '48px', color: 'var(--text3)' }}>
            <p style={{ fontSize: '11px', margin: 0 }}>Loading sound effects...</p>
          </div>
        ) : filteredSFX.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '48px', color: 'var(--text3)' }}>
            <svg
              style={{ width: '40px', height: '40px', margin: '0 auto 8px', opacity: 0.3 }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <p style={{ fontSize: '11px', margin: 0 }}>
              {searchQuery ? 'No sound effects found' : 'No sound effects available'}
            </p>
            <p style={{ fontSize: '10px', marginTop: '4px', opacity: 0.6 }}>
              {searchQuery ? 'Try a different search term' : 'Check assets/sfx folder'}
            </p>
          </div>
        ) : (
          Object.entries(groupedByCategory)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, items]) => (
              <div key={category} style={{ marginBottom: '16px' }}>
                {/* Category header */}
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: 'var(--text3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '6px',
                    padding: '0 4px'
                  }}
                >
                  {category} ({items.length})
                </div>

                {/* SFX items in this category */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {items.map((sfx) => {
                    const isPreviewing = previewingId === sfx.id

                    return (
                      <div
                        key={sfx.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, sfx)}
                        onClick={() => handlePreview(sfx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '7px 8px',
                          borderRadius: '4px',
                          background: isPreviewing ? 'rgba(79, 127, 255, 0.15)' : 'var(--bg2)',
                          border: isPreviewing ? '0.5px solid var(--accent)' : '0.5px solid var(--border)',
                          cursor: isPreviewing ? 'pointer' : 'grab',
                          transition: 'all 0.15s'
                        }}
                        onMouseEnter={(e) => {
                          if (!isPreviewing) {
                            e.currentTarget.style.borderColor = 'var(--border2)'
                            e.currentTarget.style.background = 'var(--bg3)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isPreviewing) {
                            e.currentTarget.style.borderColor = 'var(--border)'
                            e.currentTarget.style.background = 'var(--bg2)'
                          }
                        }}
                      >
                        {/* Audio icon */}
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '4px',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: isPreviewing ? 'rgba(79, 127, 255, 0.2)' : 'rgba(74, 222, 128, 0.15)'
                          }}
                        >
                          {isPreviewing ? (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--accent)">
                              <rect x="2" y="2" width="3" height="12" rx="1" />
                              <rect x="7" y="2" width="3" height="12" rx="1" />
                              <rect x="12" y="2" width="3" height="12" rx="1" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="#4ade80">
                              <path d="M8 3a5 5 0 00-5 5v2a5 5 0 0010 0V8a5 5 0 00-5-5zm0 1a4 4 0 014 4v2a4 4 0 01-8 0V8a4 4 0 014-4z" />
                              <circle cx="8" cy="9" r="2" />
                            </svg>
                          )}
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p
                            style={{
                              fontSize: '11px',
                              color: isPreviewing ? 'var(--accent)' : 'var(--text2)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              margin: 0,
                              lineHeight: '1.4',
                              fontWeight: isPreviewing ? 500 : 400
                            }}
                          >
                            {sfx.name}
                          </p>
                          <p style={{ fontSize: '10px', color: 'var(--text3)', margin: 0, lineHeight: '1.3' }}>
                            {formatDuration(sfx.durationMs)} · {(sfx.size / 1024).toFixed(1)} KB
                          </p>
                        </div>

                        {/* Play indicator */}
                        {isPreviewing && (
                          <div style={{ fontSize: '9px', color: 'var(--accent)', fontWeight: 500 }}>
                            Playing...
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  )
}

export default AudioPanel
