import { useRef, useEffect, useCallback } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { useCaption } from '../../store/useCaption'
import { useProject } from '../../store/useProject'
import { formatTime } from '../../utils/format'
import { getAnimationProgress } from '../StylePanel/AnimationPresets'
import { TransformOverlay } from './TransformOverlay'

/**
 * Preview component — dynamic canvas sized from project resolution.
 * Video plays natively (with audio), captions rendered via Canvas2D overlay.
 *
 * Playback architecture (no feedback loops):
 *  1. Source change ONLY when the active clip changes (tracked via ref)
 *  2. Manual seek ONLY when NOT playing (user scrubbed playhead)
 *  3. During playback, timeupdate → setPlayhead (video drives playhead)
 *  4. Effect 3 (play/pause) does NOT depend on playheadMs — uses ref only
 */
export function Preview(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const animFrameRef = useRef<number>(0)
  /** Track which clip is loaded in <video> to avoid redundant src changes */
  const loadedClipIdRef = useRef<string | null>(null)

  const playheadMs = useTimeline((s) => s.playheadMs)
  const clips = useTimeline((s) => s.clips)
  const isPlaying = useTimeline((s) => s.isPlaying)
  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const setPlaying = useTimeline((s) => s.setPlaying)
  const totalDurationMs = useTimeline((s) => s.totalDurationMs)
  const selectedClipId = useTimeline((s) => s.selectedClipId)
  const selectedTextClipId = useTimeline((s) => s.selectedTextClipId)
  const textClips = useTimeline((s) => s.textClips)
  const setClipTransform = useTimeline((s) => s.setClipTransform)
  const beginDragCapture = useTimeline((s) => s.beginDragCapture)
  const commitDrag = useTimeline((s) => s.commitDrag)

  const captionEntries = useTimeline((s) => s.textClips)
  const captionStyle = useCaption((s) => s.activeStyle)

  const projectResolution = useProject((s) => s.resolution)
  const masterVolume = useTimeline((s) => s.masterVolume)

  // Keep refs in sync with latest state for use inside event callbacks
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const playheadMsRef = useRef(playheadMs)
  playheadMsRef.current = playheadMs
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  const textClipsRef = useRef(textClips)
  textClipsRef.current = textClips

  // ---- helpers ----

  const findClipAt = useCallback(
    (ms: number) => clipsRef.current.find((c) => ms >= c.startMs && ms < c.startMs + c.durationMs) ?? null,
    [] // stable — reads clipsRef, never stale
  )

  /** Compute clip-local time in seconds that the video element should be at (accounts for speed) */
  const clipTimeSec = useCallback(
    (clip: { startMs: number; trimStart: number; speed?: number }, headMs: number): number =>
      ((headMs - clip.startMs + clip.trimStart) / 1000) * (clip.speed ?? 1),
    []
  )

  /** Encode a local file path to a valid file:// URL (handles Windows backslashes and spaces) */
  const toFileUrl = useCallback((filePath: string): string => {
    const forward = filePath.replace(/\\/g, '/')
    // On Windows paths start with a drive letter — prepend extra slash
    const prefix = forward.startsWith('/') ? 'file://' : 'file:///'
    return prefix + forward.split('/').map(encodeURIComponent).join('/')
  }, [])

  // ---- effect 6: apply master volume to video element ----

  useEffect(() => {
    const video = videoRef.current
    if (video) video.volume = masterVolume
  }, [masterVolume])

  // ---- effect 1: load video source only when the active clip changes ----

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const clip = findClipAt(playheadMs)
    if (!clip) {
      loadedClipIdRef.current = null
      return
    }

    // Already loaded — skip source change
    if (loadedClipIdRef.current === clip.id) return
    loadedClipIdRef.current = clip.id

    const src = toFileUrl(clip.path)
    if (video.src === src) return

    let cancelled = false

    const onLoaded = (): void => {
      if (cancelled) return
      video.currentTime = clipTimeSec(clip, playheadMs)
    }

    video.preload = 'auto'
    video.addEventListener('loadedmetadata', onLoaded, { once: true })
    video.src = src

    return () => {
      cancelled = true
      video.removeEventListener('loadedmetadata', onLoaded)
    }
  }, [findClipAt, playheadMs, clipTimeSec, toFileUrl])

  // ---- effect 2: manual seek when user scrubs (NOT during playback) ----

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlayingRef.current) return

    const clip = findClipAt(playheadMs)
    if (!clip) return

    const targetSec = clipTimeSec(clip, playheadMs)
    if (Math.abs(video.currentTime - targetSec) > 0.05) {
      video.currentTime = targetSec
    }
  }, [playheadMs, findClipAt, clipTimeSec])

  // ---- effect 3: play / pause — does NOT depend on playheadMs (uses ref) ----

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      // Seek to current playhead position via ref — avoids re-running on every setPlayhead
      const clip = findClipAt(playheadMsRef.current)
      if (clip) {
        video.currentTime = clipTimeSec(clip, playheadMsRef.current)
      }
      video.play().catch(() => {
        /* autoplay policy may block — user interaction required */
      })
    } else {
      video.pause()
    }
  }, [isPlaying, findClipAt, clipTimeSec]) // playheadMs intentionally excluded

  // ---- effect 4: sync playhead from video during playback (throttled ~30fps) ----

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let lastUpdate = 0
    const MIN_INTERVAL = 32 // ~30fps

    const onTimeUpdate = (): void => {
      if (!isPlayingRef.current) return

      const now = performance.now()
      if (now - lastUpdate < MIN_INTERVAL) return
      lastUpdate = now

      const ms = video.currentTime * 1000
      if (totalDurationMs > 0 && ms >= totalDurationMs) {
        setPlayhead(totalDurationMs)
        setPlaying(false)
        return
      }
      setPlayhead(ms)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [totalDurationMs, setPlayhead, setPlaying])

  // ---- effect 5: canvas annotation loop (captions + transform box overlay) ----

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let lastTime = 0
    const FRAME_INTERVAL = 1000 / 30

    const render = (timestamp: number): void => {
      if (timestamp - lastTime < FRAME_INTERVAL) {
        animFrameRef.current = requestAnimationFrame(render)
        return
      }
      lastTime = timestamp

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Caption rendering with animation — use per-clip style if available
      const currentMs = playheadMsRef.current
      const activeCaption = captionEntries.find(
        (e) => currentMs >= e.startMs && currentMs < e.endMs
      )
      if (activeCaption) {
        const elapsed = currentMs - activeCaption.startMs
        const totalCaptionDuration = activeCaption.endMs - activeCaption.startMs
        // Use per-clip style if the text clip has one, otherwise fall back to global caption style
        const style = activeCaption.style ?? captionStyle
        const anim = getAnimationProgress(style.animation, elapsed, totalCaptionDuration)

        // Determine display text (typewriter effect)
        let displayText = activeCaption.text
        if (style.animation === 'typewriter' && anim.charIndex >= 0) {
          displayText = activeCaption.text.slice(0, anim.charIndex)
        }

        ctx.save()
        ctx.globalAlpha = anim.opacity

        if (anim.scale !== 1 || anim.translateY !== 0) {
          ctx.translate(canvas.width / 2, canvas.height / 2)
          ctx.scale(anim.scale, anim.scale)
          ctx.translate(-canvas.width / 2, -canvas.height / 2 + anim.translateY)
        }

        // Karaoke mode: pass word timing info
        if (style.animation === 'karaoke' && activeCaption.words) {
          drawKaraokeCaption(ctx, canvas.width, canvas.height, activeCaption.text, activeCaption.words, elapsed, style)
        } else {
          drawCaption(ctx, canvas.width, canvas.height, displayText, style)
        }

        ctx.restore()
      }

      // Transform bounding box for selected video clip
      const selectedClip = clipsRef.current.find((c) => c.id === selectedClipId)
      if (selectedClip?.transform) {
        drawTransformBox(ctx, canvas.width, canvas.height, selectedClip.transform)
      }

      // TextClip transform is owned by DOM TransformOverlay — no canvas drawing

      animFrameRef.current = requestAnimationFrame(render)
    }

    animFrameRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [captionEntries, captionStyle, selectedClipId, selectedTextClipId, textClips])

  // ---- Transform box drag handling with full gizmo interaction ----
  
  const transformDragRef = useRef<{
    handle: string
    startX: number; startY: number
    startTransform: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }
  } | null>(null)
  
  // Cursor ref for dynamic cursor updates (avoids React re-renders on mousemove)
  const gizmoCursorRef = useRef<string>('default')
  
  /** Hit-test a mouse position against transform handles. Returns handle name or null. */
  const hitTestHandle = useCallback((cx: number, cy: number, t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }, canvasW: number, canvasH: number): string | null => {
    const centerX = canvasW / 2 + t.x
    const centerY = canvasH / 2 + t.y
    const hw = (canvasW * t.scaleX) / 2
    const hh = (canvasH * t.scaleY) / 2
    const rad = (t.rotation * Math.PI) / 180
    const cos = Math.cos(-rad), sin = Math.sin(-rad)
  
    // Transform mouse to local space (so handles are axis-aligned)
    const dx = cx - centerX, dy = cy - centerY
    const lx = dx * cos - dy * sin
    const ly = dx * sin + dy * cos
  
    const HANDLE_RADIUS = 8 // px in canvas coords
  
    // Check handles in priority order: rotation, corners, edges, body
    // Rotation handle (above center-top)
    const rotDist = Math.sqrt(lx * lx + (ly + hh + 20) * (ly + hh + 20))
    if (rotDist < HANDLE_RADIUS + 4) return 'rotate'
  
    // Corners
    const corners: Array<[string, number, number]> = [
      ['nw', -hw, -hh], ['ne', hw, -hh], ['sw', -hw, hh], ['se', hw, hh]
    ]
    for (const [name, hx, hy] of corners) {
      if (Math.sqrt((lx - hx) ** 2 + (ly - hy) ** 2) < HANDLE_RADIUS) return name
    }
  
    // Edges
    if (Math.abs(ly + hh) < HANDLE_RADIUS && Math.abs(lx) < hw - HANDLE_RADIUS) return 'n'
    if (Math.abs(ly - hh) < HANDLE_RADIUS && Math.abs(lx) < hw - HANDLE_RADIUS) return 's'
    if (Math.abs(lx + hw) < HANDLE_RADIUS && Math.abs(ly) < hh - HANDLE_RADIUS) return 'w'
    if (Math.abs(lx - hw) < HANDLE_RADIUS && Math.abs(ly) < hh - HANDLE_RADIUS) return 'e'
  
    // Inside bounding box
    if (lx >= -hw && lx <= hw && ly >= -hh && ly <= hh) return 'move'
  
    return null
  }, [])
  
  /** Map handle name to CSS cursor */
  const cursorForHandle = (handle: string | null): string => {
    switch (handle) {
      case 'n': case 's': return 'ns-resize'
      case 'e': case 'w': return 'ew-resize'
      case 'nw': case 'se': return 'nwse-resize'
      case 'ne': case 'sw': return 'nesw-resize'
      case 'rotate': return 'grab'
      case 'move': return 'move'
      default: return 'default'
    }
  }
  
  const handleTransformMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const selectedClip = clipsRef.current.find((c) => c.id === selectedClipId)
    if (!selectedClip?.transform) return
    const t = selectedClip.transform
  
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const cx = (e.clientX - rect.left) * scaleX
    const cy = (e.clientY - rect.top) * scaleY
  
    const handle = hitTestHandle(cx, cy, t, canvas.width, canvas.height)
    if (!handle) return
  
    transformDragRef.current = {
      handle,
      startX: cx, startY: cy,
      startTransform: { x: t.x, y: t.y, scaleX: t.scaleX, scaleY: t.scaleY, rotation: t.rotation }
    }
    beginDragCapture()
    e.stopPropagation()
  }, [selectedClipId, hitTestHandle])
  
  // Handle mousemove on canvas for cursor feedback
  const handleTransformMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !selectedClipId) return
    const clip = clipsRef.current.find((c) => c.id === selectedClipId)
    if (!clip?.transform || transformDragRef.current) return // don't change cursor during drag
  
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const cx = (e.clientX - rect.left) * scaleX
    const cy = (e.clientY - rect.top) * scaleY
  
    const handle = hitTestHandle(cx, cy, clip.transform, canvas.width, canvas.height)
    const newCursor = cursorForHandle(handle)
    if (gizmoCursorRef.current !== newCursor) {
      gizmoCursorRef.current = newCursor
      canvas.style.cursor = newCursor
    }
  }, [selectedClipId, hitTestHandle])
  
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const drag = transformDragRef.current
      if (!drag || !selectedClipId) return
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const cx = (e.clientX - rect.left) * scaleX
      const cy = (e.clientY - rect.top) * scaleY
      const dx = cx - drag.startX
      const dy = cy - drag.startY
      const st = drag.startTransform
  
      switch (drag.handle) {
        case 'move':
          setClipTransform(selectedClipId, { x: st.x + dx, y: st.y + dy })
          break
        case 'rotate': {
          // Angle from center to mouse
          const centerX = canvas.width / 2 + st.x
          const centerY = canvas.height / 2 + st.y
          const angle = Math.atan2(cy - centerY, cx - centerX) * (180 / Math.PI)
          // Wrap to [-180, 180]
          let rot = angle + 90 // offset so 0 = upright
          if (rot > 180) rot -= 360
          if (rot < -180) rot += 360
          setClipTransform(selectedClipId, { rotation: rot })
          break
        }
        case 'ne':
        case 'se': {
          const signY = drag.handle === 'ne' ? -1 : 1
          const rawScale = (st.scaleY * canvas.height + signY * dy * 2) / canvas.height
          const s = Math.max(0.05, rawScale)
          setClipTransform(selectedClipId, { scaleX: s, scaleY: s })
          break
        }
        case 'nw':
        case 'sw': {
          const signY = drag.handle === 'nw' ? -1 : 1
          const rawScale = (st.scaleY * canvas.height + signY * dy * 2) / canvas.height
          const s = Math.max(0.05, rawScale)
          setClipTransform(selectedClipId, { scaleX: s, scaleY: s })
          break
        }
        case 'n':
        case 's': {
          const sign = drag.handle === 'n' ? -1 : 1
          const rawScale = (st.scaleY * canvas.height + sign * dy * 2) / canvas.height
          setClipTransform(selectedClipId, { scaleY: Math.max(0.05, rawScale) })
          break
        }
        case 'e':
        case 'w': {
          const sign = drag.handle === 'e' ? 1 : -1
          const rawScale = (st.scaleX * canvas.width + sign * dx * 2) / canvas.width
          setClipTransform(selectedClipId, { scaleX: Math.max(0.05, rawScale) })
          break
        }
      }
    }
    const onUp = (): void => {
      commitDrag()
      transformDragRef.current = null
      // Reset cursor after drag
      const canvas = canvasRef.current
      if (canvas && selectedClipId) {
        gizmoCursorRef.current = 'move'
        canvas.style.cursor = 'move'
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [selectedClipId, setClipTransform, beginDragCapture, commitDrag])

  const togglePlay = (): void => {
    setPlaying(!isPlaying)
  }

  const pw = projectResolution.width
  const ph = projectResolution.height

  // ---- Compute video CSS transform from selected clip's transform (SSOT) ----
  const selectedClip = selectedClipId ? clips.find((c) => c.id === selectedClipId) ?? null : null
  let videoTransform: string | undefined
  if (selectedClip?.transform) {
    const t = selectedClip.transform
    // Convert canvas-pixel offsets to CSS percentages (container matches canvas aspect ratio)
    const tx = (t.x / pw) * 100
    const ty = (t.y / ph) * 100
    videoTransform = `translate(${tx}%, ${ty}%) scale(${t.scaleX}, ${t.scaleY}) rotate(${t.rotation}deg)`
  }

  return (
    <div
      className="bg-black rounded-lg overflow-hidden relative"
      style={{
        aspectRatio: `${pw} / ${ph}`,
        maxWidth: '100%',
        maxHeight: '100%',
        width: pw > ph ? '100%' : 'auto',
        height: ph > pw ? '100%' : 'auto'
      }}
    >
      {/* Video element for source — transform matches canvas TransformBox SSOT */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        style={videoTransform ? {
          transform: videoTransform,
          transformOrigin: 'center'
        } : undefined}
      />

      {/* Canvas overlay for captions + transform box */}
      <canvas
        ref={canvasRef}
        width={pw}
        height={ph}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: selectedClipId ? 'auto' : 'none', cursor: selectedClipId ? 'move' : 'default' }}
        onMouseDown={handleTransformMouseDown}
        onMouseMove={handleTransformMouseMove}
        onMouseLeave={() => {
          if (canvasRef.current) {
            gizmoCursorRef.current = selectedClipId ? 'move' : 'default'
            canvasRef.current.style.cursor = gizmoCursorRef.current
          }
        }}
      />

      {/* Interactive transform overlay — above canvas, reads same store values */}
      <TransformOverlay />

      {/* Play controls */}
      <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-center pointer-events-none">
        <button
          onClick={togglePlay}
          className="pointer-events-auto w-8 h-8 flex items-center justify-center text-white hover:text-accent transition-colors"
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="2" width="4" height="12" />
              <rect x="9" y="2" width="4" height="12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <polygon points="3,2 13,8 3,14" />
            </svg>
          )}
        </button>
      </div>

      {/* Empty state */}
      {clips.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-600 pointer-events-none">
          <div className="text-center">
            <svg
              className="w-12 h-12 mx-auto mb-2 opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <p className="text-sm">Add clips to preview</p>
          </div>
        </div>
      )}

      {/* Timecode overlay */}
      <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 rounded text-[11px] text-white font-mono select-none pointer-events-none">
        {formatTime(playheadMs)} / {formatTime(totalDurationMs)}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Caption drawing
// ---------------------------------------------------------------------------

function drawCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  style: {
    fontFamily: string
    fontSize: number
    fontWeight: number
    color: string
    strokeColor: string
    strokeWidth: number
    bgColor: string
    bgOpacity: number
    alignment: 'left' | 'center' | 'right'
    x: number
    y: number
    animation: string
  }
): void {
  const scale = width / 1080
  const fontSize = style.fontSize * scale
  const padding = 8 * scale

  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  ctx.textBaseline = 'middle'

  // Position from style.x / style.y (percentage-based, single source of truth)
  const cx = (style.x / 100) * width
  const cy = (style.y / 100) * height

  // Horizontal alignment
  const alignMap: Record<string, CanvasTextAlign> = { left: 'left', center: 'center', right: 'right' }
  ctx.textAlign = alignMap[style.alignment] ?? 'center'

  const lines = wrapText(ctx, text, width * 0.8)
  const lineHeight = fontSize * 1.3
  const totalHeight = lines.length * lineHeight

  if (style.bgOpacity > 0) {
    const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width))
    let bgX: number
    if (style.alignment === 'left') bgX = cx - padding
    else if (style.alignment === 'right') bgX = cx - maxLineWidth - padding
    else bgX = cx - maxLineWidth / 2 - padding
    const bgY = cy - totalHeight / 2 - padding
    const bgW = maxLineWidth + padding * 2
    const bgH = totalHeight + padding * 2
    ctx.fillStyle = style.bgColor
    ctx.globalAlpha *= style.bgOpacity
    ctx.fillRect(bgX, bgY, bgW, bgH)
    ctx.globalAlpha = 1
  }

  ctx.fillStyle = style.color
  ctx.strokeStyle = style.strokeColor
  ctx.lineWidth = style.strokeWidth * scale

  lines.forEach((line, i) => {
    const lineY = cy - totalHeight / 2 + i * lineHeight + lineHeight / 2
    if (style.strokeWidth > 0) ctx.strokeText(line, cx, lineY)
    ctx.fillText(line, cx, lineY)
  })
}

function drawKaraokeCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  words: Array<{ word: string; startMs: number; endMs: number }>,
  elapsedMs: number,
  style: Parameters<typeof drawCaption>[4]
): void {
  const scale = width / 1080
  const fontSize = style.fontSize * scale
  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const cx = (style.x / 100) * width
  const cy = (style.y / 100) * height
  const lineH = fontSize * 1.3

  // Find which word is active
  const activeWordIdx = words.findIndex((w) => elapsedMs >= w.startMs && elapsedMs < w.endMs)

  // Draw full text first in normal color
  ctx.fillStyle = style.color
  ctx.strokeStyle = style.strokeColor
  ctx.lineWidth = style.strokeWidth * scale
  if (style.strokeWidth > 0) ctx.strokeText(text, cx, cy)
  ctx.fillText(text, cx, cy)

  // Highlight active word in accent color
  if (activeWordIdx >= 0) {
    const activeWord = words[activeWordIdx].word
    // Measure position of word in line (simple approximation)
    const beforeText = words.slice(0, activeWordIdx).map((w) => w.word).join(' ')
    const beforeW = ctx.measureText(beforeText + (beforeText ? ' ' : '')).width
    const totalW = ctx.measureText(text).width
    const wordW = ctx.measureText(activeWord).width
    const startX = cx - totalW / 2 + beforeW
    const wordY = cy - lineH / 2

    ctx.fillStyle = '#FFD700' // gold highlight
    ctx.fillRect(startX, wordY, wordW, lineH)
    ctx.fillStyle = '#000'
    ctx.fillText(activeWord, startX + wordW / 2, cy)
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const metrics = ctx.measureText(testLine)
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

// ---------------------------------------------------------------------------
// Transform box drawing
// ---------------------------------------------------------------------------

function drawTransformBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  transform: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }
): void {
  const centerX = width / 2 + transform.x
  const centerY = height / 2 + transform.y
  const hw = (width * transform.scaleX) / 2
  const hh = (height * transform.scaleY) / 2

  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate((transform.rotation * Math.PI) / 180)

  // Dashed bounding box
  ctx.strokeStyle = 'rgba(83, 74, 183, 0.9)'
  ctx.lineWidth = 2
  ctx.setLineDash([6, 3])
  ctx.strokeRect(-hw, -hh, hw * 2, hh * 2)
  ctx.setLineDash([])

  // Corner + edge handles
  const handles = [
    [-hw, -hh], [0, -hh], [hw, -hh],
    [-hw, 0],              [hw, 0],
    [-hw, hh],  [0, hh],  [hw, hh]
  ]
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#534AB7'
  ctx.lineWidth = 1.5
  for (const [hx, hy] of handles) {
    ctx.beginPath()
    ctx.arc(hx, hy, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  // Rotation handle (above center top)
  ctx.beginPath()
  ctx.moveTo(0, -hh)
  ctx.lineTo(0, -hh - 20)
  ctx.strokeStyle = 'rgba(83, 74, 183, 0.9)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, -hh - 20, 5, 0, Math.PI * 2)
  ctx.fillStyle = '#534AB7'
  ctx.fill()

  ctx.restore()
}

export default Preview
