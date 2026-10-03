import { useRef, useEffect, useCallback, useState } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { useCaption } from '../../store/useCaption'
import { useProject } from '../../store/useProject'
import { useSelectedEntity } from '../../store/useSelectedEntity'
import { usePreviewView } from '../../store/usePreviewView'
import { formatTime } from '../../utils/format'
import { getAnimationProgress } from '../StylePanel/AnimationPresets'
import { resolveActiveWord, buildRevealText, createActivationCache, type ActivationCache } from '../../utils/wordActivation'
import { TransformOverlay } from './TransformOverlay'
import { GuideOverlay } from './GuideOverlay'
import * as AudioEngine from '../../services/AudioEngine'
import { type AudioTrack, type TextClip, computeEffectiveMuted, getInPoint, getOutPoint } from '../../store/useTimeline'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/index'
import { useConfirm } from '../../store/useConfirm'
import { computeCaptionLayout } from '../../../shared/utils/renderGeometry'
import { resolveActiveCaptions, visibleCaptionClips, captionLanePosition } from '../../../shared/captions/lanes'
import { isImageFile } from '../../../shared/media/extensions'
import type { CaptionStyle } from '../../../shared/types/caption'
import { evaluateKeyframes } from '../../services/KeyframeEvaluator'
import { buildCssFilter } from '../../services/FilterPipeline'
import { toFileUrl } from '../../../shared/utils/fileUrl'

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
  /** Still-image sibling for the base layer (P4.3) — shown iff base clip is a still. */
  const stillRef = useRef<HTMLImageElement>(null)
  const animFrameRef = useRef<number>(0)
  /** Track which clip is loaded in <video> to avoid redundant src changes */
  const loadedClipIdRef = useRef<string | null>(null)
  /** Track which still is loaded in <img> (same dedup role as loadedClipIdRef) */
  const loadedStillIdRef = useRef<string | null>(null)
  /** Per-clip activation caches — avoids O(log n) binary search every frame during playback */
  const activationCacheMapRef = useRef<Map<string, ActivationCache>>(new Map())

  const playheadMs = useTimeline((s) => s.playheadMs)
  const clips = useTimeline((s) => s.clips)
  const isPlaying = useTimeline((s) => s.isPlaying)
  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const setPlaying = useTimeline((s) => s.setPlaying)
  const totalDurationMs = useTimeline((s) => s.totalDurationMs)
  const loopEnabled = useTimeline((s) => s.loopEnabled)
  const textClips = useTimeline((s) => s.textClips)
  const audioTracks = useTimeline((s) => s.audioTracks)
  /** Timeline track lanes (for mute/solo state) */
  const trackLanes = useTimeline((s) => s.tracks)

  const { selectedClipId, selectedTextClipId } = useSelectedEntity()
  const setClipTransform = useTimeline((s) => s.setClipTransform)
  const beginDragCapture = useTimeline((s) => s.beginDragCapture)
  const commitDrag = useTimeline((s) => s.commitDrag)

  const captionEntries = useTimeline((s) => s.textClips)
  const captionStyle = useCaption((s) => s.activeStyle)

  const projectResolution = useProject((s) => s.resolution)
  const backgroundColor = useProject((s) => s.backgroundColor)
  const masterVolume = useTimeline((s) => s.masterVolume)

  // ---- Preview view state (SSOT: usePreviewView) ----
  const zoomMode = usePreviewView((s) => s.zoomMode)
  const panX = usePreviewView((s) => s.panX)
  const panY = usePreviewView((s) => s.panY)
  const quality = usePreviewView((s) => s.quality)
  const playbackSpeed = usePreviewView((s) => s.playbackSpeed)
  const isFullscreen = usePreviewView((s) => s.isFullscreen)
  const adjustPan = usePreviewView((s) => s.adjustPan)
  const setPan = usePreviewView((s) => s.setPan)
  const toggleFullscreen = usePreviewView((s) => s.toggleFullscreen)
  const resetZoom = usePreviewView((s) => s.resetZoom)
  const resetPan = usePreviewView((s) => s.resetPan)
  const setGrid = usePreviewView((s) => s.setGrid)
  const setPlaybackSpeed = usePreviewView((s) => s.setPlaybackSpeed)
  const guides = usePreviewView((s) => s.guides)
  const toggleGuide = usePreviewView((s) => s.toggleGuide)
  const cycleGrid = usePreviewView((s) => s.cycleGrid)
  const setZoomMode = usePreviewView((s) => s.setZoomMode)
  const setQuality = usePreviewView((s) => s.setQuality)

  // Container ref for ResizeObserver (computes fit/fill scale)
  const outerContainerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  // Space-key pan tracking
  const spaceDownRef = useRef(false)
  const panDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null)

  // Context menu state for preview canvas
  const [previewCtxMenu, setPreviewCtxMenu] = useState<{ x: number; y: number } | null>(null)

  // Keep refs in sync with latest state for use inside event callbacks
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  const playheadMsRef = useRef(playheadMs)
  playheadMsRef.current = playheadMs
  const totalDurationMsRef = useRef(totalDurationMs)
  totalDurationMsRef.current = totalDurationMs
  const loopEnabledRef = useRef(loopEnabled)
  loopEnabledRef.current = loopEnabled
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  const textClipsRef = useRef(textClips)
  textClipsRef.current = textClips
  const audioTracksRef = useRef(audioTracks)
  audioTracksRef.current = audioTracks
  const trackLanesRef = useRef(trackLanes)
  trackLanesRef.current = trackLanes

  // ---- ResizeObserver: track outer container size for fit/fill computation ----
  useEffect(() => {
    const el = outerContainerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const { width, height } = entry.contentRect
        setContainerSize({ w: width, h: height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- Effective scale from zoomMode + container size ----
  const pw = projectResolution.width
  const ph = projectResolution.height
  const effectiveScale = (() => {
    const cw = containerSize.w
    const ch = containerSize.h
    if (cw === 0 || ch === 0) return 1
    if (zoomMode === 'fit') return Math.min(cw / pw, ch / ph)
    if (zoomMode === 'fill') return Math.max(cw / pw, ch / ph)
    return zoomMode / 100
  })()

  // Quality divisor for canvas resolution
  const qualityDiv = quality === 'full' ? 1 : quality === 'half' ? 2 : 4
  const canvasW = Math.round(pw / qualityDiv)
  const canvasH = Math.round(ph / qualityDiv)

  // ---- helpers ----

  /** Ref for overlay video pool container */
  const overlayContainerRef = useRef<HTMLDivElement>(null)
  /** Track which clip IDs are loaded in overlay slots (video or still image) */
  const overlayAssignedRef = useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map())
  /** Track overlay audio node IDs (clipId → overlayAudioId) */
  const overlayAudioIdsRef = useRef<Map<string, string>>(new Map())
  /** Throttle for audio scrub preview */
  const lastScrubTimeRef = useRef(0)

  const findClipAt = useCallback(
    (ms: number) => {
      // Exact match only — prefer lowest trackIndex for multi-layer z-order.
      // NO fallback: if playhead is before/after all clips, return null so
      // the preview shows blank instead of a stale/wrong frame.
      const allClips = clipsRef.current
      const exact = allClips.filter((c) => ms >= c.startMs && ms < c.startMs + c.durationMs)
      if (exact.length > 0) {
        exact.sort((a, b) => a.trackIndex - b.trackIndex)
        return exact[0]
      }
      // Diagnostic: log all clips when none found at position
      if (allClips.length > 0) {
        console.log('[CLIP DIAG] No clip at ms=' + ms + ', available clips:', allClips.map(c => ({ id: c.id, startMs: c.startMs, endMs: c.startMs + c.durationMs, name: c.name })))
      }
      return null
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

  // File URLs use the canonical shared encoder (toFileUrl, imported above).

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
        const headMs = playheadMsRef.current
        AudioEngine.playTracks(
          at.map((t: AudioTrack) => ({
            id: t.id, path: t.path, startMs: t.startMs, durationMs: t.durationMs,
            volume: t.volume, muted: computeEffectiveMuted(t.muted, t.trackIndex, lanes), trimStart: t.trimStart,
            fadeInMs: t.fadeInMs, fadeOutMs: t.fadeOutMs
          })),
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

  // ---- effect 1: load video source when clip changes + always seek on playhead move ----

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const clip = findClipAt(playheadMs)
    console.log('[SRC DIAG] playheadMs:', playheadMs, 'clip:', clip ? { id: clip.id, startMs: clip.startMs, durationMs: clip.durationMs } : null)
    if (!clip) {
      loadedClipIdRef.current = null
      loadedStillIdRef.current = null
      // Clear the video source so the last frame doesn't linger when playhead is outside all clips
      if (video.src) {
        console.log('[SRC DIAG] Clearing video source (no clip at playhead)')
        video.removeAttribute('src')
        video.load()
      }
      const still = stillRef.current
      if (still) {
        still.removeAttribute('src')
        still.style.display = 'none'
      }
      return
    }

    // P4.3: still-image base layer — <img> shows the frame, <video> stands down.
    if (isImageFile(clip.path)) {
      loadedClipIdRef.current = null
      if (!video.paused) video.pause()
      if (video.src) {
        video.removeAttribute('src')
        video.load()
      }
      video.style.display = 'none'
      const still = stillRef.current
      if (still) {
        const src = toFileUrl(clip.path)
        if (loadedStillIdRef.current !== clip.id || still.getAttribute('src') !== src) {
          loadedStillIdRef.current = clip.id
          still.src = src
        }
        still.style.display = ''
      }
      return
    }
    loadedStillIdRef.current = null
    {
      const still = stillRef.current
      if (still && still.style.display !== 'none') still.style.display = 'none'
    }
    // Restore the base video element (a still may have hidden it).
    if (video.style.display === 'none') video.style.display = ''

    const src = toFileUrl(clip.proxyPath ?? clip.path)
    let cancelled = false

    // Source change needed?
    if (loadedClipIdRef.current !== clip.id || video.src !== src) {
      console.log('[SRC DIAG] Loading new source for clip:', clip.id, 'src:', src.slice(-80))
      loadedClipIdRef.current = clip.id

      const onLoaded = (): void => {
        if (cancelled) return
        const targetSec = clipTimeSec(clip, playheadMs)
        console.log('[SRC DIAG] Source loaded, seeking to:', targetSec, 'sec, isPlaying:', isPlayingRef.current)
        video.currentTime = targetSec
        if (isPlayingRef.current) {
          video.play().catch((err) => console.error('[SRC DIAG] Auto-play failed:', err.message || err))
        }
      }

      video.preload = 'auto'
      video.addEventListener('loadedmetadata', onLoaded, { once: true })
      video.src = src
    } else {
      // Source already loaded — seek to correct position (fixes stale frame bug)
      const targetSec = clipTimeSec(clip, playheadMs)
      console.log('[SRC DIAG] Source already loaded, current:', video.currentTime.toFixed(2), 'target:', targetSec.toFixed(2))
      if (Math.abs(video.currentTime - targetSec) > 0.05) {
        video.currentTime = targetSec
      }
    }

    return () => { cancelled = true }
  }, [findClipAt, playheadMs, clipTimeSec, toFileUrl, clips])

  // ---- effect 2: manual seek when user scrubs (NOT during playback) ----

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlayingRef.current) return

    const clip = findClipAt(playheadMs)
    if (!clip) return
    // P4.3: stills have no timeline to seek — the <img> is already correct.
    if (isImageFile(clip.path)) return

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
      const headMs = playheadMsRef.current
      const clip = findClipAt(headMs)
      console.log('[PLAY DIAG]', {
        headMs,
        clipFound: clip ? { id: clip.id, startMs: clip.startMs, durationMs: clip.durationMs, name: clip.name } : null,
        readyState: video.readyState,
        currentSrc: video.src ? video.src.slice(-80) : '(none)',
        loadedClipId: loadedClipIdRef.current
      })
      if (!clip) {
        console.warn('[PLAY DIAG] No clip at playhead, stopping playback')
        setPlaying(false)
        return
      }

      // Auto-snap playhead to clip start if before it (BUG-01 fix)
      let effectiveHeadMs = headMs
      if (effectiveHeadMs < clip.startMs) {
        console.log('[PLAY DIAG] Snapping playhead from', effectiveHeadMs, 'to clip start', clip.startMs)
        effectiveHeadMs = clip.startMs
        setPlayhead(effectiveHeadMs)
      }

      // P4.3: still base — nothing to play in <video> (paused, sourceless);
      // the still-advance timer owns playhead motion from here.
      if (isImageFile(clip.path)) {
        video.pause()
        return
      }

      const targetSec = clipTimeSec(clip, effectiveHeadMs)
      console.log('[PLAY DIAG] Seeking to video time:', targetSec, 'sec')

      const seekAndPlay = (): void => {
        video.currentTime = targetSec
        video.play().then(() => {
          console.log('[PLAY DIAG] Play succeeded')
        }).catch((err) => {
          console.error('[PLAY DIAG] Play failed:', err.message || err)
        })
      }

      if (video.readyState >= 1) {
        // Source already loaded — seek and play immediately
        seekAndPlay()
      } else {
        // Source still loading (effect 1 is setting src) — wait for metadata then play
        console.log('[PLAY DIAG] Video not ready (readyState=' + video.readyState + '), waiting for loadedmetadata')
        video.addEventListener('loadedmetadata', seekAndPlay, { once: true })
      }
    } else {
      video.pause()
    }
  }, [isPlaying, findClipAt, clipTimeSec, setPlayhead, setPlaying, clips]) // playheadMs intentionally excluded; clips ensures re-init on data change

  // ---- effect 3b: advance playhead across still-image base segments (P4.3) ----
  // A still in <img> emits no timeupdate, so while the playhead sits inside
  // a still base clip during playback, wall-clock drives it. End-of-segment
  // mirrors effect 4's onEnded logic (next clip / loop / stop).
  useEffect(() => {
    if (!isPlaying) return
    let last = performance.now()
    const id = window.setInterval(() => {
      if (!isPlayingRef.current) return
      const now = performance.now()
      const dt = now - last
      last = now
      const head = playheadMsRef.current
      const clip = findClipAt(head)
      if (!clip || !isImageFile(clip.path)) return
      const end = clip.startMs + clip.durationMs
      if (head + dt < end) {
        setPlayhead(head + dt)
        return
      }
      const nextClip = clipsRef.current.find((c) => c.startMs >= end && c.id !== clip.id)
      if (nextClip) {
        setPlayhead(nextClip.startMs)
        return
      }
      if (loopEnabledRef.current) {
        const inPoint = getInPoint()
        const outPoint = getOutPoint()
        if (inPoint !== null && outPoint !== null && inPoint < outPoint) {
          setPlayhead(inPoint)
          return
        }
        setPlayhead(0)
        return
      }
      setPlayhead(end)
      setPlaying(false)
    }, 100)
    return () => window.clearInterval(id)
  }, [isPlaying, findClipAt, setPlayhead, setPlaying])

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
        if (loopEnabledRef.current) {
          const inPoint = getInPoint()
          const outPoint = getOutPoint()
          if (inPoint !== null && outPoint !== null && inPoint < outPoint) {
            setPlayhead(inPoint)
            return
          }
          setPlayhead(0)
          return
        }
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
        if (loopEnabledRef.current) {
          const inPoint = getInPoint()
          const outPoint = getOutPoint()
          if (inPoint !== null && outPoint !== null && inPoint < outPoint) {
            setPlayhead(inPoint)
            return
          }
          setPlayhead(0)
          return
        }
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
    // Cap overlay elements at 4 to prevent unbounded video element creation.
    // Lower track indices get priority (they appear first in activeClips).
    const MAX_OVERLAYS = 4
    const overlayClips = activeClips.slice(1, 1 + MAX_OVERLAYS)
    const assigned = overlayAssignedRef.current
    const audioIds = overlayAudioIdsRef.current

    // Remove overlays for clips no longer active
    for (const [clipId, el] of assigned) {
      if (!overlayClips.find((c) => c.id === clipId) || clipId === baseClip?.id) {
        if (el instanceof HTMLVideoElement) {
          el.pause()
          // Disconnect overlay audio routing
          const audioId = audioIds.get(clipId)
          if (audioId) {
            AudioEngine.disconnectOverlayAudio(audioId)
            audioIds.delete(clipId)
          }
          el.removeAttribute('src')
          el.load()
        } else {
          el.removeAttribute('src')
        }
        el.style.display = 'none'
        assigned.delete(clipId)
      }
    }

    // Create/update overlay for each active higher-track clip.
    // P4.3: stills get an <img> (no playback, no audio routing); the shared
    // blend/filter/opacity styling below applies to both element kinds.
    for (let i = 0; i < overlayClips.length; i++) {
      const clip = overlayClips[i]
      if (clip.id === baseClip?.id) continue
      const clipIsStill = isImageFile(clip.path)

      let el = assigned.get(clip.id)
      if (!el || (clipIsStill !== (el instanceof HTMLImageElement))) {
        // (Re)create when missing or when the element kind no longer matches
        // (e.g. the clip's file was relinked from mp4 to png).
        if (el) {
          if (el instanceof HTMLVideoElement) {
            el.pause()
            const audioId = audioIds.get(clip.id)
            if (audioId) {
              AudioEngine.disconnectOverlayAudio(audioId)
              audioIds.delete(clip.id)
            }
          }
          el.remove()
          assigned.delete(clip.id)
        }
        if (clipIsStill) {
          const img = document.createElement('img')
          img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;'
          img.style.zIndex = String(10 + clip.trackIndex)
          img.style.display = 'none'
          container.appendChild(img)
          assigned.set(clip.id, img)
          el = img
        } else {
          const vid = document.createElement('video')
          vid.playsInline = true
          vid.muted = false // audio routed through AudioEngine, not native output
          vid.volume = 1 // gain controlled by AudioEngine GainNode
          vid.preload = 'auto'
          vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;'
          vid.style.zIndex = String(10 + clip.trackIndex)
          vid.style.display = 'none'
          container.appendChild(vid)
          assigned.set(clip.id, vid)
          el = vid

          // Connect audio through AudioEngine (createMediaElementSource once per element)
          const clipVol = (clip.muted ?? false) ? 0 : (clip.volume ?? 1)
          const audioId = AudioEngine.connectOverlayAudio(clip.id, vid, clipVol * masterVolume, clip.muted ?? false)
          if (audioId) audioIds.set(clip.id, audioId)
        }
      }

      // Stills have no proxy (P4.5) and no playback position.
      const src = toFileUrl(!clipIsStill ? (clip.proxyPath ?? clip.path) : clip.path)
      if (el instanceof HTMLImageElement) {
        if (el.getAttribute('src') !== src) el.src = src
        el.style.display = ''
      } else if (el.src !== src) {
        const vid = el
        vid.src = src
        const onLoaded = (): void => {
          vid.currentTime = clipTimeSec(clip, playheadMs)
          if (isPlayingRef.current) {
            vid.play().catch(() => {})
          }
          vid.style.display = ''
        }
        vid.addEventListener('loadedmetadata', onLoaded, { once: true })
      } else {
        if (isPlaying) {
          el.currentTime = clipTimeSec(clip, playheadMs)
          el.play().catch(() => {})
        }
        el.style.display = ''
      }

      // Apply blend mode (GPU-accelerated via CSS compositor)
      const blendMode = clip.blendMode ?? 'normal'
      el.style.mixBlendMode = blendMode

      // Apply CSS filter from modifier stack
      const cssFilter = buildCssFilter(clip.modifiers)
      el.style.filter = cssFilter

      // Apply keyframe-evaluated opacity
      const localTimeMs = playheadMs - clip.startMs
      const kfValues = evaluateKeyframes(clip.keyframes, localTimeMs)
      if (kfValues.opacity !== undefined) {
        el.style.opacity = String(kfValues.opacity / 100)
      } else {
        el.style.opacity = '1'
      }
    }

    // Pause unused overlays when no active clips
    if (activeClips.length === 0) {
      for (const [, el] of assigned) {
        if (el instanceof HTMLVideoElement) el.pause()
        el.style.display = 'none'
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

    AudioEngine.playScrub(
      at.map((t: AudioTrack) => ({
        id: t.id, path: t.path, startMs: t.startMs, durationMs: t.durationMs,
        volume: t.volume, muted: computeEffectiveMuted(t.muted, t.trackIndex, lanes), trimStart: t.trimStart
      })),
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

      // Caption rendering with animation — use per-clip style if available.
      // P2.3: overlapping captions on different lanes co-render stacked
      // (lower lane index on top). Muted/hidden/solo-excluded lanes drop
      // out (V2.2). Single-caption fast path is pixel-identical to before.
      const currentMs = playheadMsRef.current
      const paintCaption = (cap: (typeof captionEntries)[number], style: typeof captionStyle): void => {
        const elapsed = currentMs - cap.startMs
        const totalCaptionDuration = cap.endMs - cap.startMs
        // Per-clip style resolution: each TextClip has its own `style?: CaptionStyle`.
        // This means captionMode, revealFadeMs, and all visual properties are per-clip,
        // NOT global. Creators can mix karaoke + single-word + word-reveal in one timeline.
        const anim = getAnimationProgress(style.animation, elapsed, totalCaptionDuration)
        const mode = style.captionMode ?? 'full-phrase'
        const words = cap.words
        const isSynthetic = cap.wordTimestampsSource === 'synthetic'
        // Get or create per-clip activation cache (O(1) fast path for sequential playback)
        let cache = activationCacheMapRef.current.get(cap.id)
        if (!cache) {
          cache = createActivationCache()
          activationCacheMapRef.current.set(cap.id, cache)
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
            drawWordRevealCaption(ctx, canvas.width, canvas.height, cap.text, words, elapsed, style)
            break
          case 'karaoke':
            drawKaraokeCaption(ctx, canvas.width, canvas.height, cap.text, words, elapsed, style)
            break
          case 'single-word':
            drawSingleWordCaption(ctx, canvas.width, canvas.height, cap.text, activation, style)
            break
          case 'full-phrase':
          default:
            // Typewriter animation still works in full-phrase mode
            let displayText = cap.text
            if (style.animation === 'typewriter' && anim.charIndex >= 0) {
              displayText = cap.text.slice(0, anim.charIndex)
            }
            drawFullPhraseCaption(ctx, canvas.width, canvas.height, displayText, style)
            break
        }

        ctx.restore()
      }

      const visibleCaptions = visibleCaptionClips<TextClip>(captionEntries, trackLanesRef.current)
      const activeCaptions = resolveActiveCaptions(visibleCaptions, currentMs)
      if (activeCaptions.length === 1) {
        const cap = activeCaptions[0]
        paintCaption(cap, cap.style ?? captionStyle)
      } else if (activeCaptions.length > 1) {
        // Paint in reverse so the lower lane index ends up on top (z rule).
        for (let i = activeCaptions.length - 1; i >= 0; i--) {
          const cap = activeCaptions[i]
          const base = cap.style ?? captionStyle
          paintCaption(cap, { ...base, ...captionLanePosition(base, cap.trackIndex) })
        }
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
  
  /** Hit-test a mouse position against transform handles. Returns handle name or null.
   * HANDLE_RADIUS scales with display density for consistent click target size. */
  const hitTestHandle = useCallback((cx: number, cy: number, t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }, canvasW: number, canvasH: number, displayW: number, displayH: number): string | null => {
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

    // Dynamic handle radius: target ~8 CSS px regardless of canvas resolution
    const ratioX = displayW > 0 ? canvasW / displayW : 1
    const ratioY = displayH > 0 ? canvasH / displayH : 1
    const ratio = (ratioX + ratioY) / 2
    const HANDLE_RADIUS = 8 * ratio

    // Check handles in priority order: rotation, corners, edges, body
    // Rotation handle (above center-top)
    const rotDist = Math.sqrt(lx * lx + (ly + hh + 20 * ratio) * (ly + hh + 20 * ratio))
    if (rotDist < HANDLE_RADIUS + 4 * ratio) return 'rotate'

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
  
    const handle = hitTestHandle(cx, cy, t, canvas.width, canvas.height, rect.width, rect.height)
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
  
    const handle = hitTestHandle(cx, cy, clip.transform, canvas.width, canvas.height, rect.width, rect.height)
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

  // ---- Context menu handler for preview canvas ----
  const handlePreviewContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setPreviewCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])

  /** Build context menu items for the preview canvas */
  const buildPreviewCtxMenuItems = useCallback((): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      // Zoom presets
      { label: 'Fit to Window', shortcut: 'Ctrl+0', onClick: resetZoom },
      { label: 'Fill', onClick: () => setZoomMode('fill') },
      { label: '100%', onClick: () => setZoomMode(100) },
      { label: '50%', onClick: () => setZoomMode(50) },
      { label: '200%', onClick: () => setZoomMode(200) },
      { divider: true },
      // Pan
      { label: 'Reset Pan', onClick: resetPan },
      { divider: true },
      // Guides
      { label: guides.titleSafe ? '✓ Title Safe' : 'Title Safe', onClick: () => toggleGuide('titleSafe') },
      { label: guides.actionSafe ? '✓ Action Safe' : 'Action Safe', onClick: () => toggleGuide('actionSafe') },
      { label: `Grid: ${guides.grid === 'none' ? 'Off' : guides.grid === 'thirds' ? 'Thirds' : 'Center'}`, onClick: cycleGrid },
      { divider: true },
      // Quality
      { label: quality === 'full' ? '✓ Quality: Full' : 'Quality: Full', onClick: () => setQuality('full') },
      { label: quality === 'half' ? '✓ Quality: Half' : 'Quality: Half', onClick: () => setQuality('half') },
      { label: quality === 'quarter' ? '✓ Quality: Quarter' : 'Quality: Quarter', onClick: () => setQuality('quarter') },
      { divider: true },
      // Playback speed
      { label: playbackSpeed === 1 ? '✓ Speed: 1x' : 'Speed: 1x', onClick: () => setPlaybackSpeed(1) },
      { label: playbackSpeed === 0.5 ? '✓ Speed: 0.5x' : 'Speed: 0.5x', onClick: () => setPlaybackSpeed(0.5) },
      { label: playbackSpeed === 2 ? '✓ Speed: 2x' : 'Speed: 2x', onClick: () => setPlaybackSpeed(2) },
    ]
    // Reset transform — only if a clip with transform is selected
    if (selectedClipId) {
      const selClip = clips.find((c) => c.id === selectedClipId)
      if (selClip) {
        const timelineActions = useTimeline.getState()
        const isLocked = trackLanes.find((t) => t.index === selClip.trackIndex)?.locked ?? false
        items.push(
          { divider: true },
          { label: 'Rename', onClick: () => {
            useConfirm.getState().showWithInput({
              title: 'Rename Clip', message: `Rename "${selClip.name ?? 'clip'}" to:`,
              input: { initialValue: selClip.name ?? '', placeholder: 'Clip name' },
              confirmLabel: 'Rename'
            }).then((newName) => { if (newName) timelineActions.setClipName(selectedClipId, newName) })
          }},
          { label: selClip.muted ? '✓ Mute Audio' : 'Mute Audio', disabled: isLocked, onClick: () => timelineActions.setClipMute(selectedClipId, !selClip.muted) },
          { divider: true },
          { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: isLocked, onClick: () => timelineActions.duplicateClip(selectedClipId) },
          { label: 'Split at Playhead', shortcut: 'S', disabled: isLocked, onClick: () => timelineActions.splitClipAtPlayhead() },
          { label: 'Delete', shortcut: 'Del', danger: true, disabled: isLocked, onClick: () => timelineActions.deleteClip(selectedClipId) }
        )
        if (selClip.transform) {
          items.push(
            { divider: true },
            { label: 'Reset Transform', onClick: () => setClipTransform(selectedClipId, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }) }
          )
        }
      }
    }
    return items
  }, [resetZoom, resetPan, setZoomMode, setGrid, setQuality, setPlaybackSpeed,
      guides, toggleGuide, cycleGrid, quality, playbackSpeed,
      selectedClipId, clips, trackLanes, setClipTransform])

  // ---- Wheel handler: Ctrl+wheel = zoom, plain wheel = pan V, Shift+wheel = pan H ----
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      // Zoom in/out through presets
      const delta = e.deltaY < 0 ? 1 : -1
      const view = usePreviewView.getState()
      const current = typeof view.zoomMode === 'number' ? view.zoomMode : 100
      const presets = [25, 50, 100, 200, 400]
      const idx = presets.indexOf(current)
      if (idx >= 0) {
        const next = Math.max(0, Math.min(presets.length - 1, idx + delta))
        view.setZoomMode(presets[next])
      } else {
        // Between presets — snap to nearest
        const nearest = presets.reduce((a, b) => Math.abs(b - current) < Math.abs(a - current) ? b : a)
        const nIdx = presets.indexOf(nearest)
        const next = Math.max(0, Math.min(presets.length - 1, nIdx + delta))
        view.setZoomMode(presets[next])
      }
    } else if (e.shiftKey) {
      // Horizontal pan
      adjustPan(-e.deltaY * 0.5, 0)
    } else {
      // Vertical pan
      adjustPan(0, -e.deltaY * 0.5)
    }
  }, [adjustPan])

  // ---- Middle-click / Space+drag pan ----
  const handleOuterMouseDown = useCallback((e: React.MouseEvent) => {
    // Middle-click (button 1) or Space+left-click
    if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
      e.preventDefault()
      panDragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY }
      const onMove = (ev: MouseEvent): void => {
        if (!panDragRef.current) return
        const dx = ev.clientX - panDragRef.current.startX
        const dy = ev.clientY - panDragRef.current.startY
        setPan(panDragRef.current.startPanX + dx, panDragRef.current.startPanY + dy)
      }
      const onUp = (): void => {
        panDragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
  }, [panX, panY, setPan])

  // ---- Space key tracking for pan mode ----
  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !e.repeat) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        spaceDownRef.current = true
      }
    }
    const onUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceDownRef.current = false
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])

  // ---- Apply playback speed to video elements (stills ignore speed) ----
  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = playbackSpeed
    // Apply to overlay videos
    const assigned = overlayAssignedRef.current
    for (const [, el] of assigned) {
      if (el instanceof HTMLVideoElement) el.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])

  // ---- Escape exits fullscreen ----
  useEffect(() => {
    if (!isFullscreen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') toggleFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen, toggleFullscreen])

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

  // ---- Compute base clip CSS filter + keyframe overrides ----
  const baseClipAtPlayhead = clips.find(
    (c) => playheadMs >= c.startMs && playheadMs < c.startMs + c.durationMs && c.trackIndex === 0
  )
  const baseClipFilter = baseClipAtPlayhead ? buildCssFilter(baseClipAtPlayhead.modifiers) : ''
  const baseClipKf = baseClipAtPlayhead
    ? evaluateKeyframes(baseClipAtPlayhead.keyframes, playheadMs - baseClipAtPlayhead.startMs)
    : {}
  // Merge keyframe values over static transform for base clip
  if (baseClipAtPlayhead?.transform && Object.keys(baseClipKf).length > 0) {
    const t = baseClipAtPlayhead.transform
    const kfScaleX = typeof baseClipKf.scale === 'number' ? baseClipKf.scale / 100 : 1
    const kfScaleY = kfScaleX
    const kfRotation = typeof baseClipKf.rotation === 'number' ? baseClipKf.rotation : 0
    const kfX = typeof baseClipKf.positionX === 'number' ? baseClipKf.positionX : 0
    const kfY = typeof baseClipKf.positionY === 'number' ? baseClipKf.positionY : 0
    const mergedTx = ((t.x + kfX) / pw) * 100
    const mergedTy = ((t.y + kfY) / ph) * 100
    if (!selectedClipId || selectedClipId === baseClipAtPlayhead.id) {
      videoTransform = `translate(${mergedTx}%, ${mergedTy}%) scale(${t.scaleX * kfScaleX}, ${t.scaleY * kfScaleY}) rotate(${t.rotation + kfRotation}deg)`
    }
  }

  // ---- Transition state computation ----
  // Detect if playhead is within an outTransition zone on the base clip.
  // If so, compute exit opacity/transform for outgoing clip and enter for incoming.
  let transitionExitOpacity: number | undefined
  let transitionExitTransform: string | undefined
  let transitionEnterClip: typeof clips[number] | null = null
  let transitionEnterOpacity: number | undefined
  let transitionEnterTransform: string | undefined

  if (baseClipAtPlayhead?.outTransition) {
    const trans = baseClipAtPlayhead.outTransition
    const transStartMs = baseClipAtPlayhead.startMs + baseClipAtPlayhead.durationMs - trans.durationMs
    const transEndMs = baseClipAtPlayhead.startMs + baseClipAtPlayhead.durationMs
    if (playheadMs >= transStartMs && playheadMs < transEndMs) {
      const progress = (playheadMs - transStartMs) / trans.durationMs // 0→1
      const type = trans.type

      // Exit effect on outgoing clip
      if (type === 'crossfade' || type === 'dip-to-black') {
        transitionExitOpacity = 1 - progress
      } else if (type === 'slide-left') {
        transitionExitTransform = `translateX(${-progress * 100}%)`
        transitionExitOpacity = 1 - progress * 0.5
      } else if (type === 'slide-right') {
        transitionExitTransform = `translateX(${progress * 100}%)`
        transitionExitOpacity = 1 - progress * 0.5
      } else if (type === 'slide-up') {
        transitionExitTransform = `translateY(${-progress * 100}%)`
        transitionExitOpacity = 1 - progress * 0.5
      } else if (type === 'slide-down') {
        transitionExitTransform = `translateY(${progress * 100}%)`
        transitionExitOpacity = 1 - progress * 0.5
      } else if (type === 'zoom-in') {
        const s = 1 + progress * 0.5
        transitionExitTransform = `scale(${s})`
        transitionExitOpacity = 1 - progress
      } else if (type === 'zoom-out') {
        const s = 1 - progress * 0.3
        transitionExitTransform = `scale(${s})`
        transitionExitOpacity = 1 - progress
      } else if (type === 'wipe-left' || type === 'wipe-right') {
        transitionExitOpacity = 1 - progress
      }

      // Find incoming clip (next clip on same track starting at/near out-point)
      const outPointMs = baseClipAtPlayhead.startMs + baseClipAtPlayhead.durationMs
      transitionEnterClip = clips.find(
        (c) => c.trackIndex === baseClipAtPlayhead.trackIndex &&
          c.id !== baseClipAtPlayhead.id &&
          c.startMs <= outPointMs &&
          c.startMs + c.durationMs > outPointMs
      ) ?? null

      // Enter effect on incoming clip
      if (transitionEnterClip) {
        if (type === 'crossfade' || type === 'dip-to-black') {
          transitionEnterOpacity = progress
        } else if (type === 'slide-left') {
          transitionEnterTransform = `translateX(${(1 - progress) * 100}%)`
          transitionEnterOpacity = 0.5 + progress * 0.5
        } else if (type === 'slide-right') {
          transitionEnterTransform = `translateX(${-(1 - progress) * 100}%)`
          transitionEnterOpacity = 0.5 + progress * 0.5
        } else if (type === 'slide-up') {
          transitionEnterTransform = `translateY(${(1 - progress) * 100}%)`
          transitionEnterOpacity = 0.5 + progress * 0.5
        } else if (type === 'slide-down') {
          transitionEnterTransform = `translateY(${-(1 - progress) * 100}%)`
          transitionEnterOpacity = 0.5 + progress * 0.5
        } else if (type === 'zoom-in') {
          const s = 1.5 - progress * 0.5
          transitionEnterTransform = `scale(${s})`
          transitionEnterOpacity = progress
        } else if (type === 'zoom-out') {
          const s = 0.7 + progress * 0.3
          transitionEnterTransform = `scale(${s})`
          transitionEnterOpacity = progress
        } else if (type === 'wipe-left' || type === 'wipe-right') {
          transitionEnterOpacity = progress
        }
      }
    }
  }

  // Viewport dimensions (CSS pixels, before transform scale)
  const viewportW = pw * effectiveScale
  const viewportH = ph * effectiveScale

  return (
    <div
      ref={outerContainerRef}
      onWheel={handleWheel}
      onMouseDown={handleOuterMouseDown}
      style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', position: 'relative',
        cursor: spaceDownRef.current ? 'grab' : 'default'
      }}
    >
      {/* Viewport: sized to project aspect ratio, scaled by effectiveScale + pan */}
      <div
        style={{
          width: viewportW,
          height: viewportH,
          transform: `translate(${panX}px, ${panY}px)`,
          transformOrigin: 'center',
          position: 'relative',
          flexShrink: 0
        }}
      >
        {/* Canvas area with video + overlays — background from project settings */}
        <div
          className="rounded-lg overflow-hidden relative"
          style={{ width: '100%', height: '100%', backgroundColor: backgroundColor || '#000000' }}
          onContextMenu={handlePreviewContextMenu}
        >
          {/* Video element for base layer (lowest track) */}
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain"
            playsInline
            style={{
              zIndex: 0,
              ...(videoTransform ? { transform: videoTransform, transformOrigin: 'center' } : {}),
              ...(baseClipFilter ? { filter: baseClipFilter } : {}),
              ...(transitionExitOpacity !== undefined ? { opacity: transitionExitOpacity } : {}),
              ...(transitionExitTransform ? { transform: (videoTransform || '') + ' ' + transitionExitTransform, transformOrigin: 'center' } : {})
            }}
          />

          {/* Still-image sibling for the base layer (P4.3) — shown iff the
              base clip is a still (see effect 1); same transform/filter/opacity
              treatment as the video element above. */}
          <img
            ref={stillRef}
            className="absolute inset-0 w-full h-full object-contain"
            style={{
              zIndex: 0,
              display: 'none',
              ...(videoTransform ? { transform: videoTransform, transformOrigin: 'center' } : {}),
              ...(baseClipFilter ? { filter: baseClipFilter } : {}),
              ...(transitionExitOpacity !== undefined ? { opacity: transitionExitOpacity } : {}),
              ...(transitionExitTransform ? { transform: (videoTransform || '') + ' ' + transitionExitTransform, transformOrigin: 'center' } : {})
            }}
          />

          {/* Transition enter overlay — renders incoming clip during transition */}
          {transitionEnterClip && isImageFile(transitionEnterClip.path) && (
            <img
              key={`trans-enter-${transitionEnterClip.id}`}
              src={toFileUrl(transitionEnterClip.path)}
              className="absolute inset-0 w-full h-full object-contain"
              style={{
                zIndex: 4,
                opacity: transitionEnterOpacity ?? 1,
                transform: transitionEnterTransform || undefined,
                transformOrigin: 'center',
                filter: buildCssFilter(transitionEnterClip.modifiers)
              }}
            />
          )}
          {transitionEnterClip && !isImageFile(transitionEnterClip.path) && (
            <video
              key={`trans-enter-${transitionEnterClip.id}`}
              src={`file:///${encodeURI(transitionEnterClip.path.replace(/\\/g, '/'))}`}
              className="absolute inset-0 w-full h-full object-contain"
              playsInline
              muted
              style={{
                zIndex: 4,
                opacity: transitionEnterOpacity ?? 1,
                transform: transitionEnterTransform || undefined,
                transformOrigin: 'center',
                filter: buildCssFilter(transitionEnterClip.modifiers)
              }}
              ref={(el) => {
                if (el) {
                  const localMs = playheadMs - transitionEnterClip!.startMs
                  el.currentTime = Math.max(0, localMs / 1000) * (transitionEnterClip!.speed ?? 1)
                  if (isPlaying) el.play().catch(() => {})
                  else el.pause()
                }
              }}
            />
          )}

          {/* Overlay video pool for multi-layer compositing (higher tracks) */}
          <div ref={overlayContainerRef} className="absolute inset-0" style={{ zIndex: 5, pointerEvents: 'none' }} />

          {/* Canvas overlay for captions + transform box */}
          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasH}
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

          {/* Guide overlay (safe areas, grid, snap guides) */}
          <GuideOverlay />

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
          <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 rounded text-[11px] font-mono select-none pointer-events-none flex items-center gap-1">
            <span className="text-white" style={{ minWidth: 58, textAlign: 'right' }}>{formatTime(playheadMs)}</span>
            <span className="text-gray-500 text-[9px]">/</span>
            <span className="text-gray-400" style={{ minWidth: 58 }}>{formatTime(totalDurationMs)}</span>
          </div>
        </div>
      </div>
      {/* Context menu */}
      {previewCtxMenu && (
        <ContextMenu
          items={buildPreviewCtxMenuItems()}
          x={previewCtxMenu.x}
          y={previewCtxMenu.y}
          onClose={() => setPreviewCtxMenu(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Caption drawing
// ---------------------------------------------------------------------------

// All caption draw functions accept CaptionStyle directly — the canonical
// shared type. No local redeclaration needed; the top-level import covers it.
// CaptionDrawStyle is an alias kept for readability at call sites below.
type CaptionDrawStyle = CaptionStyle

/** Mode 1: Full Phrase — display entire phrase, no word-level logic */
function drawFullPhraseCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  style: CaptionDrawStyle
): void {
  // req 2.8 / F1 — layout via SSOT, not local reimplementation
  const { cx, cy, fontSize, resScale } = computeCaptionLayout(style, { width, height })
  const padding = 8 * resScale

  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  ctx.textBaseline = 'middle'

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
  // req 2.8 / F1 — layout via SSOT
  const { cx, cy, fontSize, resScale } = computeCaptionLayout(style, { width, height })
  const padding = 8 * resScale

  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  ctx.textBaseline = 'middle'

  const alignMap: Record<string, CanvasTextAlign> = { left: 'left', center: 'center', right: 'right' }
  const align = alignMap[style.alignment] ?? 'center'
  ctx.textAlign = align

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
  // req 2.8 / F1 — layout via SSOT
  const { cx, cy, fontSize, resScale } = computeCaptionLayout(style, { width, height })
  ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
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

  // Highlight active element
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

    // Active state colors — fall back to original defaults when not configured
    const highlightColor = style.activeHighlightColor ?? '#FFD700'
    const textColor = style.activeTextColor ?? '#000000'
    const activeScaleVal = style.activeScale ?? 1

    // Apply active scale as an instant snap around the active element's center.
    // ctx.save()/restore() isolates the transform — does not affect other draws.
    if (activeScaleVal !== 1) {
      const pivotX = startX + wordW / 2
      ctx.save()
      ctx.translate(pivotX, cy)
      ctx.scale(activeScaleVal, activeScaleVal)
      ctx.translate(-pivotX, -cy)
    }

    ctx.fillStyle = highlightColor
    ctx.fillRect(startX, wordY, wordW, lineH)
    ctx.fillStyle = textColor
    ctx.fillText(activeWord, startX + wordW / 2, cy)

    if (activeScaleVal !== 1) {
      ctx.restore()
    }
  }
}

/** Mode 4: Single Active Word — display only the active word, centered */
function drawSingleWordCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  _text: string,
  activation: ReturnType<typeof resolveActiveWord> | null,
  style: CaptionDrawStyle
): void {
  if (!activation?.activeWord) {
    return
  }

  const word = activation.activeWord.word
  const activeScaleVal = style.activeScale ?? 1

  // Apply active scale as an instant snap around the caption anchor.
  if (activeScaleVal !== 1) {
    const { cx, cy } = computeCaptionLayout(style, { width, height })
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(activeScaleVal, activeScaleVal)
    ctx.translate(-cx, -cy)
    drawFullPhraseCaption(ctx, width, height, word, style)
    ctx.restore()
  } else {
    drawFullPhraseCaption(ctx, width, height, word, style)
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

