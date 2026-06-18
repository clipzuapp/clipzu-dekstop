import { useRef, useEffect, useCallback, useMemo } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { useCaption } from '../../store/useCaption'
import { useProject } from '../../store/useProject'
import { formatTime } from '../../utils/format'
import { getAnimationProgress } from '../StylePanel/AnimationPresets'
import { resolveActiveWord, buildRevealText, createActivationCache, type ActivationCache } from '../../utils/wordActivation'
import { TransformOverlay } from './TransformOverlay'
import * as AudioEngine from '../../services/AudioEngine'
import type { AudioTrack } from '../../store/useTimeline'

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
  /** Per-clip activation caches — avoids O(log n) binary search every frame during playback */
  const activationCacheMapRef = useRef<Map<string, ActivationCache>>(new Map())

  const playheadMs = useTimeline((s) => s.playheadMs)
  const clips = useTimeline((s) => s.clips)
  const isPlaying = useTimeline((s) => s.isPlaying)
  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const setPlaying = useTimeline((s) => s.setPlaying)
  const totalDurationMs = useTimeline((s) => s.totalDurationMs)
  const focusedId = useTimeline((s) => s.focusedId)
  const textClips = useTimeline((s) => s.textClips)
  const audioTracks = useTimeline((s) => s.audioTracks)
  /** Timeline track lanes (for mute/solo state) */
  const trackLanes = useTimeline((s) => s.tracks)

  // Derive selected clip/text IDs from unified focusedId + entity type
  const selectedClipId = useMemo(() => {
    if (!focusedId) return null
    return clips.some((c) => c.id === focusedId) ? focusedId : null
  }, [focusedId, clips])

  const selectedTextClipId = useMemo(() => {
    if (!focusedId) return null
    return textClips.some((tc) => tc.id === focusedId) ? focusedId : null
  }, [focusedId, textClips])
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
  const audioTracksRef = useRef(audioTracks)
  audioTracksRef.current = audioTracks
  const trackLanesRef = useRef(trackLanes)
  trackLanesRef.current = trackLanes

  // ---- helpers ----

  /** Ref for overlay video pool container */
  const overlayContainerRef = useRef<HTMLDivElement>(null)
  /** Track which clip IDs are loaded in overlay slots */
  const overlayAssignedRef = useRef<Map<string, HTMLVideoElement>>(new Map())
  /** Track overlay audio node IDs (clipId → overlayAudioId) */
  const overlayAudioIdsRef = useRef<Map<string, string>>(new Map())
  /** Throttle for audio scrub preview */
  const lastScrubTimeRef = useRef(0)

  const findClipAt = useCallback(
    (ms: number) => {
      // Find exact match — prefer lowest trackIndex for multi-layer z-order
      const exact = clipsRef.current.filter((c) => ms >= c.startMs && ms < c.startMs + c.durationMs)
      if (exact.length > 0) {
        exact.sort((a, b) => a.trackIndex - b.trackIndex)
        return exact[0]
      }
      // Fallback: first clip starting after ms
      return clipsRef.current.find((c) => c.startMs >= ms) ?? null
    },
    [] // stable — reads clipsRef, never stale
  )

  /** Find ALL clips active at a timecode, sorted by trackIndex (lowest first) */
  const findAllClipsAt = useCallback(
    (ms: number): typeof clips => {
      return clipsRef.current
        .filter((c) => ms >= c.startMs && ms < c.startMs + c.durationMs)
        .sort((a, b) => a.trackIndex - b.trackIndex)
    },
    [] // stable — reads clipsRef
  )

  /** Safe version: clamps to valid video range [0, clipDuration] */
  const clipTimeSec = useCallback(
    (clip: { startMs: number; trimStart: number; trimEnd: number; durationMs: number; speed?: number }, headMs: number): number => {
      const raw = ((headMs - clip.startMs + clip.trimStart) / 1000) * (clip.speed ?? 1)
      const maxSec = ((clip.durationMs + clip.trimStart) / 1000) * (clip.speed ?? 1)
      return Math.max(0, Math.min(maxSec, raw))
    },
    []
  )

  /** Encode a local file path to a valid file:// URL (handles Windows backslashes and spaces) */
  const toFileUrl = useCallback((filePath: string): string => {
    const forward = filePath.replace(/\\/g, '/')
    // On Windows paths start with a drive letter — prepend extra slash
    const prefix = forward.startsWith('/') ? 'file://' : 'file:///'
    return prefix + forward.split('/').map(encodeURIComponent).join('/')
  }, [])

  // ---- effect 6: apply master volume × clip volume to video element ----

  useEffect(() => {
    const video = videoRef.current
    if (video) {
      const clip = clips.find((c) => c.id === loadedClipIdRef.current)
      // Mute the video element if the clip is muted (Inspector toggle)
      const clipVol = (clip?.muted ?? false) ? 0 : (clip?.volume ?? 1)
      video.volume = masterVolume * clipVol
    }

    // Sync overlay audio volumes via AudioEngine
    const activeClips = findAllClipsAt(playheadMsRef.current)
    const overlayClips = activeClips.slice(1)
    for (const overlayClip of overlayClips) {
      const audioId = overlayAudioIdsRef.current.get(overlayClip.id)
      if (audioId) {
        const clipVol = (overlayClip.muted ?? false) ? 0 : (overlayClip.volume ?? 1)
        AudioEngine.updateOverlayAudioVol(audioId, clipVol * masterVolume, false)
      }
    }
  }, [masterVolume, clips, findAllClipsAt])

  // ---- effect 0 + 4c: preload audio buffers then start playback (TASK-A fix) ----
  // Merged preload + play into a single async effect to fix race condition:
  // previously, preload was fire-and-forget and playback could start before
  // buffers were decoded, causing SFX tracks to be silently skipped.
  // Track-level mute/solo is folded into effectiveMuted per audio track.

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      if (isPlaying) {
        AudioEngine.resumeAudio()
        // Await ALL buffer preloads before starting playback
        const at = audioTracksRef.current
        await Promise.all(
          at.map((t: AudioTrack) => t.path ? AudioEngine.preloadBuffer(t.path) : Promise.resolve())
        )
        if (cancelled) return

        // Compute track-level mute/solo for each audio track
        const lanes = trackLanesRef.current
        const hasSolo = lanes.some((l) => l.solo)
        const headMs = playheadMsRef.current
        AudioEngine.playTracks(
          at.map((t: AudioTrack) => {
            const parentTrack = lanes.find((l) => l.kind === 'audio' && l.index === t.trackIndex)
            const laneMuted = parentTrack?.muted ?? false
            const laneSolo = parentTrack?.solo ?? false
            const effectiveMuted = t.muted || laneMuted || (hasSolo && !laneSolo)
            return {
              id: t.id, path: t.path, startMs: t.startMs, durationMs: t.durationMs,
              volume: t.volume, muted: effectiveMuted, trimStart: t.trimStart,
              fadeInMs: t.fadeInMs, fadeOutMs: t.fadeOutMs
            }
          }),
          headMs,
          masterVolume
        )
      } else {
        AudioEngine.stopAll()
      }
    }

    run()
    return () => { cancelled = true }
  }, [isPlaying, masterVolume, audioTracks, trackLanes])

  // ---- effect: preload audio buffers eagerly for scrub preview ----
  // Ensures buffers are decoded even before first playback so scrubbing works.

  useEffect(() => {
    if (isPlaying) return
    for (const t of audioTracks) {
      if (t.path) AudioEngine.preloadBuffer(t.path)
    }
  }, [audioTracks, isPlaying])

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
      // If we're in playing state, resume playback on the new source (Bug A fix)
      if (isPlayingRef.current) {
        video.play().catch(() => { /* autoplay policy */ })
      }
    }

    video.preload = 'auto'
    video.addEventListener('loadedmetadata', onLoaded, { once: true })
    video.src = src

    return () => {
      cancelled = true
      video.removeEventListener('loadedmetadata', onLoaded)
    }
  }, [findClipAt, playheadMs, clipTimeSec, toFileUrl, clips])

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
      const clip = findClipAt(playheadMsRef.current)
      if (!clip) {
        setPlaying(false)
        return
      }

      // Auto-snap playhead to clip start if before it (BUG-01 fix)
      let headMs = playheadMsRef.current
      if (headMs < clip.startMs) {
        headMs = clip.startMs
        setPlayhead(headMs)
      }

      const seekAndPlay = (): void => {
        video.currentTime = clipTimeSec(clip, headMs)
        video.play().catch(() => {
          /* autoplay policy may block — user interaction required */
        })
      }

      if (video.readyState >= 1) {
        // Source already loaded — seek and play immediately
        seekAndPlay()
      } else {
        // Source still loading (effect 1 is setting src) — wait for metadata then play
        video.addEventListener('loadedmetadata', seekAndPlay, { once: true })
      }
    } else {
      video.pause()
    }
  }, [isPlaying, findClipAt, clipTimeSec, setPlayhead, setPlaying, clips]) // playheadMs intentionally excluded; clips ensures re-init on data change

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

      // Convert clip-local video time → timeline-global position (Bug A + B fix)
      const currentClipId = loadedClipIdRef.current
      const currentClip = currentClipId ? clipsRef.current.find(c => c.id === currentClipId) : null
      let timelineMs: number
      if (currentClip) {
        // Reverse of clipTimeSec: headMs = startMs - trimStart + (videoTime * 1000) / speed
        timelineMs = currentClip.startMs - currentClip.trimStart + (video.currentTime * 1000) / (currentClip.speed || 1)
      } else {
        timelineMs = video.currentTime * 1000
      }

      if (totalDurationMs > 0 && timelineMs >= totalDurationMs) {
        setPlayhead(totalDurationMs)
        setPlaying(false)
        return
      }
      setPlayhead(timelineMs)
    }

    // When video reaches end of source, advance to next clip or stop (Bug 2 fix)
    const onEnded = (): void => {
      if (!isPlayingRef.current) return
      const currentClipId = loadedClipIdRef.current
      const currentClip = currentClipId ? clipsRef.current.find(c => c.id === currentClipId) : null
      if (!currentClip) { setPlaying(false); return }
      const clipEnd = currentClip.startMs + currentClip.durationMs
      // Find the next clip that starts at or after the current clip's end
      const nextClip = clipsRef.current.find(c => c.startMs >= clipEnd && c.id !== currentClip.id)
      if (nextClip) {
        setPlayhead(nextClip.startMs)
        // Effect 1 will load the next clip; onLoaded in effect 1 auto-plays (isPlayingRef is true)
      } else {
        setPlayhead(clipEnd)
        setPlaying(false)
      }
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', onEnded)
    }
  }, [totalDurationMs, setPlayhead, setPlaying])

  // ---- effect 4b: video overlays for multi-layer compositing (BUG-03 fix) ----
  // Overlay audio is routed through AudioEngine via createMediaElementSource.

  useEffect(() => {
    const container = overlayContainerRef.current
    if (!container) return
    const activeClips = findAllClipsAt(playheadMs)
    const baseClip = activeClips.length > 0 ? activeClips[0] : null
    const overlayClips = activeClips.slice(1) // higher tracks
    const assigned = overlayAssignedRef.current
    const audioIds = overlayAudioIdsRef.current

    // Remove overlays for clips no longer active
    for (const [clipId, vid] of assigned) {
      if (!overlayClips.find((c) => c.id === clipId) || clipId === baseClip?.id) {
        vid.pause()
        // Disconnect overlay audio routing
        const audioId = audioIds.get(clipId)
        if (audioId) {
          AudioEngine.disconnectOverlayAudio(audioId)
          audioIds.delete(clipId)
        }
        vid.removeAttribute('src')
        vid.load()
        vid.style.display = 'none'
        assigned.delete(clipId)
      }
    }

    // Create/update overlay for each active higher-track clip
    for (let i = 0; i < overlayClips.length; i++) {
      const clip = overlayClips[i]
      if (clip.id === baseClip?.id) continue

      let vid = assigned.get(clip.id)
      if (!vid) {
        vid = document.createElement('video')
        vid.playsInline = true
        vid.muted = false // audio routed through AudioEngine, not native output
        vid.volume = 1 // gain controlled by AudioEngine GainNode
        vid.preload = 'auto'
        vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;'
        vid.style.zIndex = String(10 + clip.trackIndex)
        vid.style.display = 'none'
        container.appendChild(vid)
        assigned.set(clip.id, vid)

        // Connect audio through AudioEngine (createMediaElementSource once per element)
        const clipVol = (clip.muted ?? false) ? 0 : (clip.volume ?? 1)
        const audioId = AudioEngine.connectOverlayAudio(clip.id, vid, clipVol * masterVolume, clip.muted ?? false)
        if (audioId) audioIds.set(clip.id, audioId)
      }

      const src = toFileUrl(clip.path)
      if (vid.src !== src) {
        vid.src = src
        const onLoaded = (): void => {
          vid!.currentTime = clipTimeSec(clip, playheadMs)
          if (isPlayingRef.current) {
            vid!.play().catch(() => {})
          }
          vid!.style.display = ''
        }
        vid.addEventListener('loadedmetadata', onLoaded, { once: true })
      } else {
        if (isPlaying) {
          vid.currentTime = clipTimeSec(clip, playheadMs)
          vid.play().catch(() => {})
        }
        vid.style.display = ''
      }
    }

    // Pause unused overlays when no active clips
    if (activeClips.length === 0) {
      for (const [, vid] of assigned) {
        vid.pause()
        vid.style.display = 'none'
      }
    }
  }, [playheadMs, isPlaying, findAllClipsAt, clipTimeSec, toFileUrl, clips, masterVolume])

  // ---- effect 4d: audio scrub preview when not playing ----
  // Plays a short audio burst from each active audio track when the playhead
  // is moved while paused, providing audible feedback during scrubbing.

  useEffect(() => {
    if (isPlayingRef.current) return

    const now = performance.now()
    if (now - lastScrubTimeRef.current < 60) return // throttle to ~16Hz
    lastScrubTimeRef.current = now

    const at = audioTracksRef.current
    const lanes = trackLanesRef.current
    const hasSolo = lanes.some((l) => l.solo)

    AudioEngine.playScrub(
      at.map((t: AudioTrack) => {
        const parentTrack = lanes.find((l) => l.kind === 'audio' && l.index === t.trackIndex)
        const laneMuted = parentTrack?.muted ?? false
        const laneSolo = parentTrack?.solo ?? false
        const effectiveMuted = t.muted || laneMuted || (hasSolo && !laneSolo)
        return {
          id: t.id, path: t.path, startMs: t.startMs, durationMs: t.durationMs,
          volume: t.volume, muted: effectiveMuted, trimStart: t.trimStart
        }
      }),
      playheadMs,
      masterVolume
    )
  }, [playheadMs, masterVolume, audioTracks, trackLanes])

  // ---- effect 5: canvas annotation loop (captions + transform box overlay) ----

  // Prune stale activation caches when textClips change (clips removed/merged/split)
  useEffect(() => {
    const currentIds = new Set(textClips.map((tc) => tc.id))
    for (const id of activationCacheMapRef.current.keys()) {
      if (!currentIds.has(id)) {
        activationCacheMapRef.current.delete(id)
      }
    }
  }, [textClips])

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
        // Per-clip style resolution: each TextClip has its own `style?: CaptionStyle`.
        // This means captionMode, revealFadeMs, and all visual properties are per-clip,
        // NOT global. Creators can mix karaoke + single-word + word-reveal in one timeline.
        const style = activeCaption.style ?? captionStyle
        const anim = getAnimationProgress(style.animation, elapsed, totalCaptionDuration)
        const mode = style.captionMode ?? 'full-phrase'
        const words = activeCaption.words
        const isSynthetic = activeCaption.wordTimestampsSource === 'synthetic'
        // Get or create per-clip activation cache (O(1) fast path for sequential playback)
        let cache = activationCacheMapRef.current.get(activeCaption.id)
        if (!cache) {
          cache = createActivationCache()
          activationCacheMapRef.current.set(activeCaption.id, cache)
        }
        const activation = words ? resolveActiveWord(words, elapsed, isSynthetic, cache) : null

        ctx.save()
        ctx.globalAlpha = anim.opacity

        if (anim.scale !== 1 || anim.translateY !== 0) {
          // Transform around the caption's actual position, not canvas center
          const originX = (style.x / 100) * canvas.width
          const originY = (style.y / 100) * canvas.height
          ctx.translate(originX, originY)
          ctx.scale(anim.scale, anim.scale)
          ctx.translate(-originX, -originY + anim.translateY)
        }

        // Dispatch to caption mode renderer
        switch (mode) {
          case 'word-reveal':
            drawWordRevealCaption(ctx, canvas.width, canvas.height, activeCaption.text, words, elapsed, style)
            break
          case 'karaoke':
            drawKaraokeCaption(ctx, canvas.width, canvas.height, activeCaption.text, words, elapsed, style)
            break
          case 'single-word':
            drawSingleWordCaption(ctx, canvas.width, canvas.height, activation, style)
            break
          case 'full-phrase':
          default:
            // Typewriter animation still works in full-phrase mode
            let displayText = activeCaption.text
            if (style.animation === 'typewriter' && anim.charIndex >= 0) {
              displayText = activeCaption.text.slice(0, anim.charIndex)
            }
            drawFullPhraseCaption(ctx, canvas.width, canvas.height, displayText, style)
            break
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

  // ---- Cleanup: dispose audio engine on unmount ----

  useEffect(() => {
    return () => {
      AudioEngine.stopAll()
      AudioEngine.clearScrub()
      // Disconnect all overlay audio routing
      for (const [, audioId] of overlayAudioIdsRef.current) {
        AudioEngine.disconnectOverlayAudio(audioId)
      }
      overlayAudioIdsRef.current.clear()
      // Clean up overlay video elements
      const container = overlayContainerRef.current
      if (container) {
        while (container.firstChild) {
          const vid = container.firstChild as HTMLVideoElement
          vid.pause()
          vid.removeAttribute('src')
          container.removeChild(vid)
        }
      }
      overlayAssignedRef.current.clear()
    }
  }, [])

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
      {/* Video element for base layer (lowest track) */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        style={{ zIndex: 0, ...(videoTransform ? {
          transform: videoTransform,
          transformOrigin: 'center'
        } : {}) }}
      />

      {/* Overlay video pool for multi-layer compositing (higher tracks) */}
      <div ref={overlayContainerRef} className="absolute inset-0" style={{ zIndex: 5, pointerEvents: 'none' }} />

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
      <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-center px-2 pointer-events-none">
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

// Shared style type used by all caption drawing functions.
// NOTE: This is the VISUAL LAYER — it consumes timing data from the word
// activation engine (resolveActiveWord) but does not compute timing itself.
// Font, color, scale, outline, etc. are kept separate from {activeWord, prevWord, nextWord}.
interface CaptionDrawStyle {
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
  /** Uniform scale multiplier (1.0 = native size). Applied on top of resolution scale. */
  scale: number
  /** Entry-level animation preset */
  animation: 'none' | 'pop' | 'fade' | 'slide-up' | 'karaoke' | 'typewriter'
  /** Word-level caption display mode */
  captionMode: 'full-phrase' | 'word-reveal' | 'karaoke' | 'single-word'
  /** Smooth word reveal fade duration in ms. 0 = instant (default). */
  revealFadeMs?: number
}

/** Mode 1: Full Phrase — display entire phrase, no word-level logic */
function drawFullPhraseCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  style: CaptionDrawStyle
): void {
  const resScale = width / 1080
  const fontSize = style.fontSize * resScale * (style.scale ?? 1)
  const padding = 8 * resScale

  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  ctx.textBaseline = 'middle'

  const cx = (style.x / 100) * width
  const cy = (style.y / 100) * height

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
  ctx.lineWidth = style.strokeWidth * resScale

  lines.forEach((line, i) => {
    const lineY = cy - totalHeight / 2 + i * lineHeight + lineHeight / 2
    if (style.strokeWidth > 0) ctx.strokeText(line, cx, lineY)
    ctx.fillText(line, cx, lineY)
  })
}

/** Mode 2: Word Reveal — words become visible only after their startTime.
 *  Supports optional revealFadeMs for smooth word appearance. */
function drawWordRevealCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fullText: string,
  words: Array<{ word: string; startMs: number; endMs: number }> | undefined,
  elapsedMs: number,
  style: CaptionDrawStyle
): void {
  if (!words || words.length === 0) {
    drawFullPhraseCaption(ctx, width, height, fullText, style)
    return
  }

  const revealFadeMs = style.revealFadeMs ?? 0
  const activation = resolveActiveWord(words, elapsedMs, false)

  // Determine the index of the last visible word
  let lastVisibleIdx = -1
  if (activation.activeWord) {
    lastVisibleIdx = activation.activeIndex
  } else if (activation.nextWord && activation.prevWord) {
    // In a gap — show up to prevWord
    lastVisibleIdx = words.indexOf(activation.prevWord)
  } else if (activation.prevWord && !activation.nextWord) {
    // Past all words — show full text
    lastVisibleIdx = words.length - 1
  }

  if (lastVisibleIdx < 0) return

  // Fast path: no fade or last word fully faded in — use batch draw
  if (revealFadeMs <= 0 || words.length === 0 || elapsedMs - words[lastVisibleIdx].startMs >= revealFadeMs) {
    const revealText = buildRevealText(words, lastVisibleIdx)
    if (revealText) drawFullPhraseCaption(ctx, width, height, revealText, style)
    return
  }

  // Smooth path: render each word individually so the last word can fade in
  drawWordRevealSmooth(ctx, width, height, words, lastVisibleIdx, elapsedMs, revealFadeMs, style)
}

/**
 * Per-word smooth reveal renderer.
 * Draws each revealed word at the correct screen position with individual opacity.
 * Handles text wrapping, alignment, stroke, and background box.
 */
function drawWordRevealSmooth(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  words: Array<{ word: string; startMs: number; endMs: number }>,
  lastVisibleIdx: number,
  elapsedMs: number,
  revealFadeMs: number,
  style: CaptionDrawStyle
): void {
  const resScale = width / 1080
  const fontSize = style.fontSize * resScale * (style.scale ?? 1)
  const padding = 8 * resScale

  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  ctx.textBaseline = 'middle'

  const alignMap: Record<string, CanvasTextAlign> = { left: 'left', center: 'center', right: 'right' }
  const align = alignMap[style.alignment] ?? 'center'
  ctx.textAlign = align

  const cx = (style.x / 100) * width
  const cy = (style.y / 100) * height
  const lineHeight = fontSize * 1.3
  const maxWidth = width * 0.8

  // Smoothstep easing for natural fade feel
  const lastWord = words[lastVisibleIdx]
  const rawProgress = Math.max(0, Math.min(1, (elapsedMs - lastWord.startMs) / revealFadeMs))
  const easedFade = rawProgress * rawProgress * (3 - 2 * rawProgress) // smoothstep

  // Build word-wrapped lines with per-word opacity
  interface WordSpan { text: string; opacity: number; wordIdx: number }
  const lines: WordSpan[][] = []
  let currentLine: WordSpan[] = []
  let currentLineWidth = 0

  for (let i = 0; i <= lastVisibleIdx; i++) {
    const w = words[i]
    // First word on a line has no leading space
    const displayText = currentLine.length === 0 ? w.word : ' ' + w.word
    const wordWidth = ctx.measureText(displayText).width
    const opacity = i === lastVisibleIdx ? easedFade : 1

    if (currentLine.length > 0 && currentLineWidth + wordWidth > maxWidth) {
      lines.push(currentLine)
      currentLine = []
      currentLineWidth = 0
      // Re-measure without leading space for new line
      const noSpaceText = w.word
      const noSpaceWidth = ctx.measureText(noSpaceText).width
      currentLine.push({ text: noSpaceText, opacity, wordIdx: i })
      currentLineWidth = noSpaceWidth
    } else {
      currentLine.push({ text: displayText, opacity, wordIdx: i })
      currentLineWidth += wordWidth
    }
  }
  if (currentLine.length > 0) lines.push(currentLine)

  const totalHeight = lines.length * lineHeight

  // Draw background box behind all lines (single rectangle, full opacity)
  if (style.bgOpacity > 0) {
    let maxLineW = 0
    for (const line of lines) {
      const fullText = line.map((s) => s.text).join('')
      const lw = ctx.measureText(fullText).width
      if (lw > maxLineW) maxLineW = lw
    }

    let bgX: number
    if (align === 'left') bgX = cx - padding
    else if (align === 'right') bgX = cx - maxLineW - padding
    else bgX = cx - maxLineW / 2 - padding
    const bgY = cy - totalHeight / 2 - padding
    const bgW = maxLineW + padding * 2
    const bgH = totalHeight + padding * 2

    ctx.fillStyle = style.bgColor
    ctx.globalAlpha = style.bgOpacity
    ctx.fillRect(bgX, bgY, bgW, bgH)
    ctx.globalAlpha = 1
  }

  // Draw each word with its individual opacity
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const fullLineText = line.map((s) => s.text).join('')
    const fullLineWidth = ctx.measureText(fullLineText).width
    const lineY = cy - totalHeight / 2 + li * lineHeight + lineHeight / 2

    let startX: number
    if (align === 'center') startX = cx - fullLineWidth / 2
    else if (align === 'right') startX = cx - fullLineWidth
    else startX = cx

    let cursorX = startX

    for (const span of line) {
      // Remove leading space for rendering (the space is baked into measurements)
      const renderText = span.text.replace(/^ /, '')
      const spanWidth = ctx.measureText(span.text).width
      const wordCenterX = cursorX + spanWidth / 2

      ctx.globalAlpha = span.opacity
      ctx.fillStyle = style.color
      ctx.strokeStyle = style.strokeColor
      ctx.lineWidth = style.strokeWidth * resScale

      if (style.strokeWidth > 0) {
        ctx.strokeText(renderText, wordCenterX, lineY)
      }
      ctx.fillText(renderText, wordCenterX, lineY)

      cursorX += spanWidth
    }
  }

  ctx.globalAlpha = 1
}

/** Mode 3: Karaoke Highlight — full phrase visible, active word highlighted */
function drawKaraokeCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  words: Array<{ word: string; startMs: number; endMs: number }> | undefined,
  elapsedMs: number,
  style: CaptionDrawStyle
): void {
  const resScale = width / 1080
  const fontSize = style.fontSize * resScale * (style.scale ?? 1)
  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const cx = (style.x / 100) * width
  const cy = (style.y / 100) * height
  const lineH = fontSize * 1.3

  if (!words || words.length === 0) {
    // Fallback: draw normally without highlight
    drawFullPhraseCaption(ctx, width, height, text, style)
    return
  }

  const activation = resolveActiveWord(words, elapsedMs, false)

  // Draw full text first in normal color
  ctx.fillStyle = style.color
  ctx.strokeStyle = style.strokeColor
  ctx.lineWidth = style.strokeWidth * resScale
  if (style.strokeWidth > 0) ctx.strokeText(text, cx, cy)
  ctx.fillText(text, cx, cy)

  // Highlight active word
  if (activation.activeWord) {
    const activeIdx = activation.activeIndex
    const activeWord = activation.activeWord.word
    // Measure position of word in the full text
    const beforeText = words.slice(0, activeIdx).map((w) => w.word).join(' ')
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

/** Mode 4: Single Active Word — display only the active word, centered */
function drawSingleWordCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  activation: ReturnType<typeof resolveActiveWord> | null,
  style: CaptionDrawStyle
): void {
  if (!activation?.activeWord) return

  const word = activation.activeWord.word
  drawFullPhraseCaption(ctx, width, height, word, style)
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

