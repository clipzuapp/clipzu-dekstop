import { useTimeline } from '../../store/useTimeline'
import { useProject } from '../../store/useProject'
import { formatTime } from '../../utils/format'

/**
 * PlaybackControls — playback buttons + timecode + volume + aspect ratio
 * Height: 40px, background var(--bg1), border-top 0.5px solid var(--border)
 */
export function PlaybackControls(): JSX.Element {
  const isPlaying = useTimeline((s) => s.isPlaying)
  const playheadMs = useTimeline((s) => s.playheadMs)
  const totalDurationMs = useTimeline((s) => s.totalDurationMs)
  const setPlaying = useTimeline((s) => s.setPlaying)
  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const masterVolume = useTimeline((s) => s.masterVolume)
  const setMasterVolume = useTimeline((s) => s.setMasterVolume)

  const aspectRatio = useProject((s) => s.aspectRatio)
  const zoom = useTimeline((s) => s.zoom)

  const handlePlayPause = (): void => {
    setPlaying(!isPlaying)
  }

  const handleRewind = (): void => {
    setPlayhead(Math.max(0, playheadMs - 5000))
  }

  const handleForward = (): void => {
    setPlayhead(Math.min(totalDurationMs, playheadMs + 5000))
  }

  const handleJumpStart = (): void => {
    if (isPlaying) setPlaying(false) // Stop playback when jumping to start
    setPlayhead(0)
  }

  const handleJumpEnd = (): void => {
    setPlayhead(totalDurationMs)
  }

  return (
    <div
      style={{
        height: '40px',
        background: 'var(--bg1)',
        borderTop: '0.5px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        gap: '8px',
        flexShrink: 0
      }}
    >
      {/* Left group: playback buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button
          className="toolbar-btn"
          onClick={handleJumpStart}
          title="Jump to start"
          style={{ padding: '5px 8px' }}
        >
          ⏮
        </button>
        <button
          className="toolbar-btn"
          onClick={handleRewind}
          title="Rewind 5s (J)"
          style={{ padding: '5px 8px' }}
        >
          J
        </button>
        <button
          className="toolbar-btn"
          onClick={handlePlayPause}
          title="Play/Pause (Space)"
          style={{
            padding: '5px 10px',
            background: 'var(--bg3)',
            fontWeight: 500
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="toolbar-btn"
          onClick={handleForward}
          title="Forward 5s (L)"
          style={{ padding: '5px 8px' }}
        >
          L
        </button>
        <button
          className="toolbar-btn"
          onClick={handleJumpEnd}
          title="Jump to end"
          style={{ padding: '5px 8px' }}
        >
          ⏭
        </button>
      </div>

      {/* Timecode */}
      <div
        className="timecode"
        style={{
          marginLeft: '8px',
          fontSize: '10px'
        }}
      >
        {formatTime(playheadMs)} / {formatTime(totalDurationMs)}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text2)' }}>{masterVolume === 0 ? '🔇' : '🔊'}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(masterVolume * 100)}
          onChange={(e) => setMasterVolume(Number(e.target.value) / 100)}
          className="slider"
          style={{ width: '60px', height: '3px' }}
        />
      </div>

      <div className="separator" />

      {/* Aspect ratio dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text2)' }}>{aspectRatio || '16:9'}</span>
        <span style={{ fontSize: '8px', color: 'var(--text3)' }}>▾</span>
      </div>

      <div className="separator" />

      {/* Zoom dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text2)' }}>{Math.round(zoom * 100)}%</span>
        <span style={{ fontSize: '8px', color: 'var(--text3)' }}>▾</span>
      </div>
    </div>
  )
}

export default PlaybackControls
