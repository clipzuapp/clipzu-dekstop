import React, { useRef, useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTimeline, getClipboard } from '../../store/useTimeline'
import { useCaption } from '../../store/useCaption'
import { useConfirm } from '../../store/useConfirm'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/index'
import { formatTime } from '../../utils/format'
import { getWaveform, extractWaveform } from '../../services/WaveformService'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACK_LANE_H = 36
const LANE_GAP = 4
const LANE_LABEL_W = 128  // wider to accommodate DOM header buttons
const RULER_H = 24
const SNAP_THRESHOLD_PX = 12

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveTool = 'select' | 'blade' | 'hand' | 'zoom'

interface TimelineProps {
  activeTool?: ActiveTool
}

// ---------------------------------------------------------------------------
// Timeline component
// ---------------------------------------------------------------------------

export function Timeline({ activeTool = 'select' }: TimelineProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    clips, audioTracks, tracks, markers,
    playheadMs, totalDurationMs, zoom,
    selectedClipId, isPlaying
  } = useTimeline(
    useShallow((s) => ({
      clips: s.clips,
      audioTracks: s.audioTracks,
      tracks: s.tracks,
      markers: s.markers,
      playheadMs: s.playheadMs,
      totalDurationMs: s.totalDurationMs,
      zoom: s.zoom,
      selectedClipId: s.selectedClipId,
      isPlaying: s.isPlaying
    }))
  )

  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const setZoom = useTimeline((s) => s.setZoom)
  const selectClip = useTimeline((s) => s.selectClip)
  const deselectAll = useTimeline((s) => s.deselectAll)
  const moveClip = useTimeline((s) => s.moveClip)
  const moveClipLive = useTimeline((s) => s.moveClipLive)
  const trimClip = useTimeline((s) => s.trimClip)
  const trimClipLive = useTimeline((s) => s.trimClipLive)
  const updateTextClipLive = useTimeline((s) => s.updateTextClipLive)
  const beginDragCapture = useTimeline((s) => s.beginDragCapture)
  const commitDrag = useTimeline((s) => s.commitDrag)
  const cancelDrag = useTimeline((s) => s.cancelDrag)
  const moveAudioTrack = useTimeline((s) => s.moveAudioTrack)
  const splitClipAtPlayhead = useTimeline((s) => s.splitClipAtPlayhead)
  const toggleMuteTrack = useTimeline((s) => s.toggleMuteTrack)
  const toggleLockTrack = useTimeline((s) => s.toggleLockTrack)
  const toggleHideTrack = useTimeline((s) => s.toggleHideTrack)
  const addTrack = useTimeline((s) => s.addTrack)
  const deleteTrack = useTimeline((s) => s.deleteTrack)
  const deleteClip = useTimeline((s) => s.deleteClip)
  const duplicateClip = useTimeline((s) => s.duplicateClip)
  const renameTrack = useTimeline((s) => s.renameTrack)
  const toggleClipSelection = useTimeline((s) => s.toggleClipSelection)
  const selectClipRange = useTimeline((s) => s.selectClipRange)
  const selectedClipIds = useTimeline((s) => s.selectedClipIds)
  const rippleDeleteClip = useTimeline((s) => s.rippleDeleteClip)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  // Caption entries for the purple Captions track
  const captionEntries = useTimeline((s) => s.textClips)
  const selectedCaptionId = useTimeline((s) => s.selectedTextClipId)

  const PIXELS_PER_MS = 0.1 * zoom

  // ---- Build lane layout ----

  // Determine video lane count from tracks array (not just clips) so that
  // +Video creates visible lanes even when no clip has been added yet.
  const videoTrackCount = Math.max(
    1,
    ...tracks.filter((t) => t.kind === 'video').map((t) => t.index + 1),
    ...clips.map((c) => c.trackIndex + 1)
  )
  const videoTrackIndices = Array.from({ length: videoTrackCount }, (_, i) => i)

  // Audio lane count: use tracks array, fall back to audioTracks length
  const audioTrackCount = Math.max(
    audioTracks.length > 0 ? audioTracks.length : 1,
    tracks.filter((t) => t.kind === 'audio').length
  )

  const captionLaneCount = captionEntries.length > 0 ? 1 : 0
  const totalLanes = videoTrackIndices.length + audioTrackCount + captionLaneCount
  const totalH = RULER_H + totalLanes * (TRACK_LANE_H + LANE_GAP)

  // ---- Canvas rendering (RAF-throttled to prevent excessive redraws) ----

  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    // Cancel any pending RAF from previous state change
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
    }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null

      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const w = Math.max(container.clientWidth, 400)
      const h = Math.max(container.clientHeight, totalH)
      canvas.width = w
      canvas.height = h

      ctx.fillStyle = '#0e0e12'
      ctx.fillRect(0, 0, w, h)

      drawRuler(ctx, w, LANE_LABEL_W, RULER_H, PIXELS_PER_MS, totalDurationMs, markers)

      for (let i = 0; i < totalLanes; i++) {
        const y = RULER_H + i * (TRACK_LANE_H + LANE_GAP)
        ctx.fillStyle = i % 2 === 0 ? '#101014' : '#121218'
        ctx.fillRect(LANE_LABEL_W, y, w - LANE_LABEL_W, TRACK_LANE_H)
      }

      // Video clips (viewport-culled for performance)
      const clipViewStartMs = (container.scrollLeft - LANE_LABEL_W - 200) / PIXELS_PER_MS
      const clipViewEndMs = (container.scrollLeft + container.clientWidth) / PIXELS_PER_MS
      clips.forEach((clip) => {
        // Skip clips outside visible viewport
        if (clip.startMs + clip.durationMs < clipViewStartMs || clip.startMs > clipViewEndMs) return
        const laneIdx = videoTrackIndices.indexOf(clip.trackIndex)
        const y = RULER_H + (laneIdx >= 0 ? laneIdx : 0) * (TRACK_LANE_H + LANE_GAP)
        const isHidden = tracks.find((t) => t.index === clip.trackIndex)?.hidden ?? false
        if (!isHidden) {
          drawClip(ctx, clip, LANE_LABEL_W, y, PIXELS_PER_MS, clip.id === selectedClipId || selectedClipIds.includes(clip.id))
        }
      })

      // Audio tracks — one lane each from actual audioTracks, plus empty placeholders
      for (let ai = 0; ai < audioTrackCount; ai++) {
        const audioLaneY = RULER_H + (videoTrackIndices.length + ai) * (TRACK_LANE_H + LANE_GAP)
        const track = audioTracks[ai]
        if (track) {
          drawAudioTrack(ctx, track, LANE_LABEL_W, audioLaneY, PIXELS_PER_MS, w)
        }
      }

      // ---- Caption blocks (purple track, viewport-culled) ----
      if (captionEntries.length > 0) {
        const captionLaneY = RULER_H + (videoTrackIndices.length + audioTrackCount) * (TRACK_LANE_H + LANE_GAP)
        // Calculate visible time range for viewport culling
        const viewStartMs = (container.scrollLeft - LANE_LABEL_W - 200) / PIXELS_PER_MS
        const viewEndMs = (container.scrollLeft + container.clientWidth) / PIXELS_PER_MS
        for (const entry of captionEntries) {
          // Skip captions outside visible viewport
          if (entry.endMs < viewStartMs || entry.startMs > viewEndMs) continue

          const bx = LANE_LABEL_W + entry.startMs * PIXELS_PER_MS
          const bw = Math.max((entry.endMs - entry.startMs) * PIXELS_PER_MS, 4)
          const by = captionLaneY + 2
          const bh = TRACK_LANE_H - 4
          const isCapSel = entry.id === selectedCaptionId

          ctx.save()
          ctx.fillStyle = isCapSel ? '#5b21b6' : '#3b1578'
          roundRect(ctx, bx, by, bw, bh, 3)
          ctx.fill()
          ctx.strokeStyle = isCapSel ? '#8b5cf6' : '#4c1d95'
          ctx.lineWidth = isCapSel ? 2 : 1
          roundRect(ctx, bx, by, bw, bh, 3)
          ctx.stroke()

          if (bw > 24) {
            ctx.fillStyle = '#e0d0ff'
            ctx.font = '9px Inter, system-ui, sans-serif'
            ctx.save()
            ctx.beginPath()
            ctx.rect(bx + 4, by, bw - 8, bh)
            ctx.clip()
            ctx.fillText(entry.text, bx + 4, by + bh / 2 + 3)
            ctx.restore()
          }
          ctx.restore()
        }
      }

      // Playhead
      const px = LANE_LABEL_W + playheadMs * PIXELS_PER_MS
      if (px >= LANE_LABEL_W && px <= w) {
        ctx.save()
        ctx.strokeStyle = '#534AB7'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, h)
        ctx.stroke()
        ctx.fillStyle = '#534AB7'
        ctx.beginPath()
        ctx.moveTo(px - 6, 0)
        ctx.lineTo(px + 6, 0)
        ctx.lineTo(px, 8)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }

      // Tool cursor indicator on ruler
      if (activeTool === 'blade') {
        ctx.fillStyle = 'rgba(255, 80, 80, 0.15)'
        ctx.fillRect(LANE_LABEL_W, 0, w - LANE_LABEL_W, RULER_H)
      }
    })

    // Cleanup: cancel pending RAF when effect re-fires or component unmounts
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [clips, audioTracks, tracks, markers, playheadMs, totalDurationMs, zoom, selectedClipId,
    PIXELS_PER_MS, totalH, videoTrackIndices, totalLanes, activeTool,
    captionEntries, selectedCaptionId, selectedClipIds])

  // ---- Defensive drag cleanup: commit on blur, cancel on Escape ----
  useEffect(() => {
    const onBlur = (): void => { commitDrag() }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') cancelDrag()
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
    }
  }, [commitDrag, cancelDrag])

  // ---- Auto-scroll to keep playhead in view during playback ----

  useEffect(() => {
    const container = containerRef.current
    if (!container || !isPlaying) return
    const px = LANE_LABEL_W + playheadMs * PIXELS_PER_MS
    const containerW = container.clientWidth
    const scrollLeft = container.scrollLeft
    // Auto-scroll when playhead goes past 80% of visible area
    if (px > scrollLeft + containerW * 0.8) {
      container.scrollLeft = px - containerW * 0.2
    }
  }, [playheadMs, PIXELS_PER_MS, isPlaying])

  // ---- Trigger waveform extraction when audio tracks change ----
  useEffect(() => {
    for (const track of audioTracks) {
      if (track.path) extractWaveform(track.path)
    }
  }, [audioTracks])

  // ---- Click to seek / blade / zoom ----

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left - LANE_LABEL_W
      if (x <= 0) return

      const clickMs = Math.max(0, x / PIXELS_PER_MS)

      if (activeTool === 'blade') {
        setPlayhead(clickMs)
        setTimeout(() => splitClipAtPlayhead(), 0)
        return
      }
      if (activeTool === 'zoom') {
        if (e.altKey) {
          setZoom(zoom / 1.5)
        } else {
          setZoom(zoom * 1.5)
        }
        return
      }
      setPlayhead(clickMs)
    },
    [PIXELS_PER_MS, setPlayhead, activeTool, zoom, setZoom, splitClipAtPlayhead]
  )

  // ---- Scroll to zoom ----

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const canvas = canvasRef.current
        const container = containerRef.current
        if (canvas && container) {
          // Zoom-to-cursor: preserve time position under mouse
          const rect = canvas.getBoundingClientRect()
          const mouseX = e.clientX - rect.left - LANE_LABEL_W
          const timeUnderCursor = mouseX / PIXELS_PER_MS
          const oldZoom = zoom
          const newZoom = Math.max(0.1, Math.min(10, oldZoom + (e.deltaY > 0 ? -0.1 : 0.1)))
          const newPPM = 0.1 * newZoom
          const newScrollLeft = timeUnderCursor * newPPM - mouseX + LANE_LABEL_W
          container.scrollLeft = newScrollLeft
          setZoom(newZoom)
        } else {
          setZoom(zoom + (e.deltaY > 0 ? -0.1 : 0.1))
        }
      }
    },
    [zoom, setZoom, PIXELS_PER_MS]
  )

  // ---- Snap helper ----

  const snapToEdge = useCallback(
    (rawMs: number, excludeClipId?: string): number => {
      const thresholdMs = SNAP_THRESHOLD_PX / PIXELS_PER_MS
      let bestMs = rawMs
      let bestDist = thresholdMs

      for (const c of clips) {
        if (c.id === excludeClipId) continue
        const dStart = Math.abs(rawMs - c.startMs)
        if (dStart < bestDist) { bestDist = dStart; bestMs = c.startMs }
        const dEnd = Math.abs(rawMs - (c.startMs + c.durationMs))
        if (dEnd < bestDist) { bestDist = dEnd; bestMs = c.startMs + c.durationMs }
      }
      // Snap to audio track edges
      for (const a of audioTracks) {
        const dStart = Math.abs(rawMs - a.startMs)
        if (dStart < bestDist) { bestDist = dStart; bestMs = a.startMs }
        const dEnd = Math.abs(rawMs - (a.startMs + a.durationMs))
        if (dEnd < bestDist) { bestDist = dEnd; bestMs = a.startMs + a.durationMs }
      }
      // Snap to caption edges
      for (const tc of captionEntries) {
        const dStart = Math.abs(rawMs - tc.startMs)
        if (dStart < bestDist) { bestDist = dStart; bestMs = tc.startMs }
        const dEnd = Math.abs(rawMs - tc.endMs)
        if (dEnd < bestDist) { bestDist = dEnd; bestMs = tc.endMs }
      }
      // Snap to playhead
      const dPlayhead = Math.abs(rawMs - playheadMs)
      if (dPlayhead < bestDist) { bestDist = dPlayhead; bestMs = playheadMs }
      // Snap to origin
      if (Math.abs(rawMs) < bestDist) bestMs = 0
      return Math.max(0, Math.round(bestMs))
    },
    [clips, audioTracks, captionEntries, PIXELS_PER_MS, playheadMs]
  )

  // ---- Drag (window-level for reliable capture) ----

  const dragRef = useRef<{
    clipId: string
    startX: number
    startMs: number
    startTrackIndex: number
    startY: number
  } | null>(null)

  const handScrollRef = useRef<{ startX: number; startScrollLeft: number } | null>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left - LANE_LABEL_W
      const y = e.clientY - rect.top - RULER_H

      // ---- Ruler click-to-seek (top RULER_H pixels) ----
      if (y < 0) {
        const newMs = Math.max(0, Math.min(totalDurationMs, x / PIXELS_PER_MS))
        setPlayhead(newMs)
        return
      }

      // Hand tool — scroll timeline
      if (activeTool === 'hand') {
        handScrollRef.current = {
          startX: e.clientX,
          startScrollLeft: containerRef.current?.scrollLeft ?? 0
        }
        const onMove = (ev: MouseEvent): void => {
          if (!handScrollRef.current || !containerRef.current) return
          const dx = ev.clientX - handScrollRef.current.startX
          containerRef.current.scrollLeft = handScrollRef.current.startScrollLeft - dx
        }
        const onUp = (): void => {
          handScrollRef.current = null
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return
      }

      if (activeTool !== 'select') return

      // ---- Hit-test audio tracks ----
      for (let ai = 0; ai < audioTrackCount; ai++) {
        const audioLaneY = (videoTrackIndices.length + ai) * (TRACK_LANE_H + LANE_GAP)
        const track = audioTracks[ai]
        if (track && y >= audioLaneY && y <= audioLaneY + TRACK_LANE_H) {
          const ax = track.startMs * PIXELS_PER_MS
          const aw = Math.max(track.durationMs * PIXELS_PER_MS, 40)
          if (x >= ax && x <= ax + aw) {
            beginDragCapture()
            const startClientX = e.clientX
            const origStartMs = track.startMs
            const onAudioMove = (ev: MouseEvent): void => {
              const dx = ev.clientX - startClientX
              const deltaMs = dx / PIXELS_PER_MS
              moveAudioTrack(track.id, Math.max(0, origStartMs + deltaMs))
            }
            const onAudioUp = (): void => {
              commitDrag()
              window.removeEventListener('mousemove', onAudioMove)
              window.removeEventListener('mouseup', onAudioUp)
            }
            window.addEventListener('mousemove', onAudioMove)
            window.addEventListener('mouseup', onAudioUp)
            return
          }
        }
      }

      // ---- Hit-test caption blocks ----
      if (captionEntries.length > 0) {
        const captionLaneIdx = videoTrackIndices.length + audioTrackCount
        const captionLaneY = captionLaneIdx * (TRACK_LANE_H + LANE_GAP)
        if (y >= captionLaneY && y <= captionLaneY + TRACK_LANE_H) {
          const clickedCaption = captionEntries.find((entry) => {
            const ex = entry.startMs * PIXELS_PER_MS
            const ew = Math.max((entry.endMs - entry.startMs) * PIXELS_PER_MS, 4)
            return x >= ex && x <= ex + ew
          })
          if (clickedCaption) {
            useCaption.getState().selectEntry(clickedCaption.id)
            setPlayhead(clickedCaption.startMs)

            // Trim edge detection for caption/text blocks
            const ex = clickedCaption.startMs * PIXELS_PER_MS
            const ew = Math.max((clickedCaption.endMs - clickedCaption.startMs) * PIXELS_PER_MS, 4)
            const nearLeft = x - ex < 8
            const nearRight = ex + ew - x < 8

            if (nearLeft) {
              beginDragCapture()
              const origStartMs = clickedCaption.startMs
              const origEndMs = clickedCaption.endMs
              const startX = e.clientX
              const onTrimMove = (ev: MouseEvent): void => {
                const dx = ev.clientX - startX
                const deltaMs = dx / PIXELS_PER_MS
                const newStart = Math.max(0, origStartMs + deltaMs)
                if (newStart < origEndMs - 100) {
                  updateTextClipLive(clickedCaption.id, { startMs: newStart, durationMs: origEndMs - newStart })
                }
              }
              const onTrimUp = (): void => {
                commitDrag()
                window.removeEventListener('mousemove', onTrimMove)
                window.removeEventListener('mouseup', onTrimUp)
              }
              window.addEventListener('mousemove', onTrimMove)
              window.addEventListener('mouseup', onTrimUp)
              return
            }

            if (nearRight) {
              beginDragCapture()
              const origStartMs = clickedCaption.startMs
              const origEndMs = clickedCaption.endMs
              const startX = e.clientX
              const onTrimMove = (ev: MouseEvent): void => {
                const dx = ev.clientX - startX
                const deltaMs = dx / PIXELS_PER_MS
                const newEnd = Math.max(origStartMs + 100, origEndMs + deltaMs)
                updateTextClipLive(clickedCaption.id, { endMs: newEnd, durationMs: newEnd - origStartMs })
              }
              const onTrimUp = (): void => {
                commitDrag()
                window.removeEventListener('mousemove', onTrimMove)
                window.removeEventListener('mouseup', onTrimUp)
              }
              window.addEventListener('mousemove', onTrimMove)
              window.addEventListener('mouseup', onTrimUp)
              return
            }

            // ---- Caption body drag-to-move ----
            beginDragCapture()
            const capStartClientX = e.clientX
            const capOrigStartMs = clickedCaption.startMs
            const capDurMs = clickedCaption.endMs - clickedCaption.startMs
            const onCapMove = (ev: MouseEvent): void => {
              const dx = ev.clientX - capStartClientX
              const deltaMs = dx / PIXELS_PER_MS
              const newStart = Math.max(0, capOrigStartMs + deltaMs)
              updateTextClipLive(clickedCaption.id, {
                startMs: newStart,
                endMs: newStart + capDurMs,
                durationMs: capDurMs
              })
            }
            const onCapUp = (): void => {
              commitDrag()
              window.removeEventListener('mousemove', onCapMove)
              window.removeEventListener('mouseup', onCapUp)
            }
            window.addEventListener('mousemove', onCapMove)
            window.addEventListener('mouseup', onCapUp)
            return
          }
        }
      }

      // Hit-test clips
      const clickedClip = clips.find((clip) => {
        const laneIdx = videoTrackIndices.indexOf(clip.trackIndex)
        const clipY = (laneIdx >= 0 ? laneIdx : 0) * (TRACK_LANE_H + LANE_GAP)
        const clipX = clip.startMs * PIXELS_PER_MS
        const clipW = clip.durationMs * PIXELS_PER_MS
        return x >= clipX && x <= clipX + clipW && y >= clipY && y <= clipY + TRACK_LANE_H
      })

      if (clickedClip) {
        // Check if track is locked
        const isLocked = tracks.find((t) => t.index === clickedClip.trackIndex)?.locked ?? false
        if (isLocked) return

        // ---- Trim edges take PRECEDENCE over selection and body drag ----
        const clipX = clickedClip.startMs * PIXELS_PER_MS
        const clipW = clickedClip.durationMs * PIXELS_PER_MS
        const nearLeft = x - clipX < 8
        const nearRight = clipX + clipW - x < 8

        if (nearLeft) {
          // Select the clip so trim handle highlight is visible
          selectClip(clickedClip.id)
          // ---- Trim left edge (adjust trimStart) ----
          beginDragCapture()
          const startX = e.clientX
          const origTrimStart = clickedClip.trimStart
          const origTrimEnd = clickedClip.trimEnd
          const onTrimMove = (ev: MouseEvent): void => {
            const dx = ev.clientX - startX
            const deltaMs = dx / PIXELS_PER_MS
            const maxTrim = clickedClip.sourceDurationMs - origTrimEnd - 100
            const newTrimStart = Math.max(0, Math.min(maxTrim, origTrimStart + deltaMs))
            trimClipLive(clickedClip.id, newTrimStart, origTrimEnd)
          }
          const onTrimUp = (): void => {
            commitDrag()
            window.removeEventListener('mousemove', onTrimMove)
            window.removeEventListener('mouseup', onTrimUp)
          }
          window.addEventListener('mousemove', onTrimMove)
          window.addEventListener('mouseup', onTrimUp)
          return
        }

        if (nearRight) {
          // Select the clip so trim handle highlight is visible
          selectClip(clickedClip.id)
          // ---- Trim right edge (adjust trimEnd) ----
          beginDragCapture()
          const startX = e.clientX
          const origTrimStart = clickedClip.trimStart
          const origTrimEnd = clickedClip.trimEnd
          const onTrimMove = (ev: MouseEvent): void => {
            const dx = startX - ev.clientX
            const deltaMs = dx / PIXELS_PER_MS
            const maxTrim = clickedClip.sourceDurationMs - origTrimStart - 100
            const newTrimEnd = Math.max(0, Math.min(maxTrim, origTrimEnd + deltaMs))
            trimClipLive(clickedClip.id, origTrimStart, newTrimEnd)
          }
          const onTrimUp = (): void => {
            commitDrag()
            window.removeEventListener('mousemove', onTrimMove)
            window.removeEventListener('mouseup', onTrimUp)
          }
          window.addEventListener('mousemove', onTrimMove)
          window.addEventListener('mouseup', onTrimUp)
          return
        }

        // ---- Selection (after trim check — only body hits reach here) ----
        // Multi-select: Shift = range, Ctrl = toggle, plain = exclusive
        if (e.shiftKey) {
          selectClipRange(clickedClip.id)
        } else if (e.ctrlKey || e.metaKey) {
          toggleClipSelection(clickedClip.id)
        } else {
          selectClip(clickedClip.id)
        }

        // ---- Clip body drag-to-move (multi-select aware) ----
        beginDragCapture()
        const isMultiDrag = selectedClipIds.length > 1 && selectedClipIds.includes(clickedClip.id)
        const multiStartPositions = isMultiDrag
          ? clips.filter((c) => selectedClipIds.includes(c.id)).map((c) => ({ id: c.id, startMs: c.startMs, trackIndex: c.trackIndex }))
          : null
        dragRef.current = {
          clipId: clickedClip.id,
          startX: x,
          startMs: clickedClip.startMs,
          startTrackIndex: clickedClip.trackIndex,
          startY: y
        }

        const onDragMove = (ev: MouseEvent): void => {
          if (!dragRef.current) return
          const dragRect = canvas.getBoundingClientRect()
          const dx = ev.clientX - dragRect.left - LANE_LABEL_W
          const dy = ev.clientY - dragRect.top - RULER_H
          const rawMs = dragRef.current.startMs + (dx - dragRef.current.startX) / PIXELS_PER_MS
          const snappedMs = snapToEdge(rawMs, dragRef.current.clipId)
          const newTrackIndex = Math.max(0, Math.floor(dy / (TRACK_LANE_H + LANE_GAP)))

          if (isMultiDrag && multiStartPositions) {
            const deltaMs = snappedMs - dragRef.current.startMs
            const deltaTrack = newTrackIndex - dragRef.current.startTrackIndex
            useTimeline.setState((state) => {
              for (const sp of multiStartPositions) {
                const clip = state.clips.find((c) => c.id === sp.id)
                if (clip) {
                  clip.startMs = Math.max(0, sp.startMs + deltaMs)
                  clip.trackIndex = Math.max(0, sp.trackIndex + deltaTrack)
                }
              }
              state.totalDurationMs = Math.max(...state.clips.map((c) => c.startMs + c.durationMs), 0)
            })
          } else {
            moveClipLive(dragRef.current.clipId, snappedMs, newTrackIndex)
          }
        }

        const onDragUp = (): void => {
          commitDrag()
          dragRef.current = null
          window.removeEventListener('mousemove', onDragMove)
          window.removeEventListener('mouseup', onDragUp)
        }

        window.addEventListener('mousemove', onDragMove)
        window.addEventListener('mouseup', onDragUp)
        return
      }

      // ---- No clip/caption hit: fall through to playhead drag or deselect ----

      // Playhead drag-to-scrub (within 10px of playhead line — only if no clip under cursor)
      const playheadX = playheadMs * PIXELS_PER_MS
      if (Math.abs(x - playheadX) < 10) {
        e.preventDefault()
        const onMove = (ev: MouseEvent): void => {
          const moveRect = canvas.getBoundingClientRect()
          const moveX = ev.clientX - moveRect.left - LANE_LABEL_W
          const newMs = Math.max(0, Math.min(totalDurationMs, moveX / PIXELS_PER_MS))
          setPlayhead(newMs)
        }
        const onUp = (): void => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return
      }

      deselectAll()
    },
    [clips, audioTracks, tracks, PIXELS_PER_MS, selectClip, deselectAll, moveClip, trimClip, snapToEdge, videoTrackIndices, activeTool, playheadMs, totalDurationMs, setPlayhead,
      captionEntries, toggleClipSelection, selectClipRange, selectedClipIds, audioTrackCount, moveAudioTrack, beginDragCapture, commitDrag, updateTextClipLive, moveClipLive, trimClipLive]
  )

  // ---- HTML5 drop target (receive drag from MediaPanel library or move existing clips) ----

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/capcraft-media')) {
      e.preventDefault()
      // Library drags = copy; existing clip drags = move
      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move'
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const raw = e.dataTransfer.getData('application/capcraft-media')
      if (!raw) return
      try {
        const data = JSON.parse(raw)
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const dropMs = Math.max(0, (e.clientX - rect.left - LANE_LABEL_W) / PIXELS_PER_MS)

        // New library item — has 'path' key: create a brand-new clip/track on the timeline
        if (data.path) {
          const snappedMs = snapToEdge(dropMs)
          const ts = Date.now()
          const rand = Math.random().toString(36).slice(2, 6)

          if (data.isAudio) {
            useTimeline.getState().addAudioTrack({
              id: `audio_${ts}_${rand}`,
              path: data.path,
              startMs: snappedMs,
              durationMs: data.durationMs ?? 0,
              volume: 1,
              muted: false,
              name: data.name ?? 'Audio',
              role: 'music'
            })
          } else {
            useTimeline.getState().addClip({
              id: `clip_${ts}_${rand}`,
              path: data.path,
              startMs: snappedMs,
              sourceDurationMs: data.durationMs ?? 0,
              durationMs: data.durationMs ?? 0,
              trackIndex: 0,
              trimStart: 0,
              trimEnd: 0,
              name: data.name ?? 'Clip',
              speed: 1.0
            })
          }
          return
        }

        // Existing timeline item — has 'id' key: move it
        const { id, kind } = data as { id: string; kind: 'clip' | 'audio' }
        if (kind === 'clip') {
          const clip = clips.find((c) => c.id === id)
          if (clip) moveClip(id, snapToEdge(dropMs))
        } else if (kind === 'audio') {
          const track = audioTracks.find((a) => a.id === id)
          if (track) moveAudioTrack(id, Math.max(0, dropMs))
        }
      } catch { /* invalid data */ }
    },
    [clips, audioTracks, PIXELS_PER_MS, moveClip, moveAudioTrack, snapToEdge]
  )

  // ---- Build DOM track headers ----

  const allLanes: Array<{ kind: 'video' | 'audio' | 'caption'; index: number; trackId: string; name: string }> = [
    ...videoTrackIndices.map((ti) => {
      const t = tracks.find((tr) => tr.index === ti && tr.kind === 'video')
      return { kind: 'video' as const, index: ti, trackId: t?.id ?? `track_v${ti}`, name: t?.name ?? `Video ${ti + 1}` }
    }),
    ...Array.from({ length: audioTrackCount }, (_, i) => {
      const t = tracks.find((tr) => tr.kind === 'audio' && tr.index === i)
      return {
        kind: 'audio' as const, index: i,
        trackId: t?.id ?? `audio_track_${i}`,
        name: t?.name ?? `Audio ${i + 1}`
      }
    })
  ]
  if (captionEntries.length > 0) {
    allLanes.push({ kind: 'caption', index: 0, trackId: 'caption_track', name: 'Captions' })
  }

  return (
    <div className="w-full h-full relative overflow-hidden flex flex-col">
      {/* Toolbar: Add Track + Zoom */}
      <div className="flex items-center justify-between px-2 py-0.5 bg-editor-panel border-b border-editor-border shrink-0">
        <div className="flex gap-1">
          <button
            className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-editor-surface"
            onClick={() => addTrack('video')}
          >
            + Video
          </button>
          <button
            className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-editor-surface"
            onClick={() => addTrack('audio')}
          >
            + Audio
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-300 text-xs rounded bg-editor-surface"
            onClick={() => setZoom(Math.max(0.1, zoom - 0.2))}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="7" width="12" height="2" />
            </svg>
          </button>
          <span className="text-[10px] text-gray-500 w-8 text-center tabular-nums">
            {(zoom * 100).toFixed(0)}%
          </span>
          <button
            className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-300 text-xs rounded bg-editor-surface"
            onClick={() => setZoom(Math.min(10, zoom + 0.2))}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="7" width="12" height="2" />
              <rect x="7" y="2" width="2" height="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Timeline body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Track header sidebar — DOM layer over left LANE_LABEL_W px */}
        <div
          className="shrink-0 bg-editor-panel border-r border-editor-border flex flex-col"
          style={{ width: LANE_LABEL_W, paddingTop: RULER_H }}
        >
          {allLanes.map((lane, i) => {
            const track = tracks.find((t) => t.id === lane.trackId)
            return (
              <div
                key={`${lane.kind}-${lane.index}-${i}`}
                className="group flex items-center justify-between px-1 shrink-0 border-b border-editor-border/20"
                style={{ height: TRACK_LANE_H + LANE_GAP, gap: 2 }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const t = tracks.find((tr) => tr.id === lane.trackId)
                  setCtxMenu({
                    x: e.clientX, y: e.clientY,
                    items: [
                      { label: 'Add Track Above', onClick: () => addTrack(lane.kind === 'caption' ? 'video' : lane.kind) },
                      { label: 'Add Track Below', onClick: () => addTrack(lane.kind === 'caption' ? 'video' : lane.kind) },
                      { divider: true },
                      { label: 'Generate Captions', disabled: lane.kind !== 'video' || clips.filter((c) => c.trackIndex === lane.index).length === 0, onClick: () => {
                        useCaption.getState().transcribeTrack(lane.index)
                      }},
                      { divider: true },
                      { label: 'Set as Voice', disabled: lane.kind !== 'audio', onClick: () => {
                        const matched = audioTracks.find((a) => a.id === lane.trackId)
                        if (matched) {
                          useTimeline.setState((s) => {
                            const t = s.audioTracks.find((a2) => a2.id === matched.id)
                            if (t) t.role = 'voice'
                          })
                        }
                      }},
                      { label: 'Set as Music', disabled: lane.kind !== 'audio', onClick: () => {
                        const matched = audioTracks.find((a) => a.id === lane.trackId)
                        if (matched) {
                          useTimeline.setState((s) => {
                            const t = s.audioTracks.find((a2) => a2.id === matched.id)
                            if (t) t.role = 'music'
                          })
                        }
                      }},
                      { divider: true },
                      { label: 'Rename Track', onClick: () => {
                        if (t) {
                          const newName = window.prompt('Track name:', t.name)
                          if (newName && newName.trim()) renameTrack(t.id, newName.trim())
                        }
                      }, disabled: !t },
                      { label: 'Delete Track', danger: true, disabled: !t, onClick: () => {
                        if (t) {
                          useConfirm.getState().show({
                            title: 'Delete Track',
                            message: `Delete track "${t.name}" and all clips on it? This cannot be undone.`,
                            variant: 'danger',
                            confirmLabel: 'Delete'
                          }).then((c) => { if (c) deleteTrack(t.id) })
                        }
                      }}
                    ]
                  })
                }}
              >
                <span
                  className="text-[10px] text-gray-500 truncate flex-1"
                  title={lane.name}
                >
                  {lane.name}
                </span>
                {track && (
                  <div className="flex gap-0.5">
                    <TrackButton
                      active={!!track.muted}
                      activeColor="text-yellow-400"
                      title="Mute"
                      onClick={() => toggleMuteTrack(track.id)}
                    >
                      M
                    </TrackButton>
                    <TrackButton
                      active={!!track.locked}
                      activeColor="text-red-400"
                      title="Lock"
                      onClick={() => toggleLockTrack(track.id)}
                    >
                      L
                    </TrackButton>
                    <TrackButton
                      active={!!track.hidden}
                      activeColor="text-gray-300"
                      title="Hide"
                      onClick={() => toggleHideTrack(track.id)}
                    >
                      H
                    </TrackButton>
                    <button
                      className="w-4 h-4 flex items-center justify-center text-[9px] rounded text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete track"
                      onClick={() => {
                        useConfirm.getState().show({
                          title: 'Delete Track',
                          message: `Delete track "${track.name}" and all clips on it? This cannot be undone.`,
                          variant: 'danger',
                          confirmLabel: 'Delete'
                        }).then((confirmed) => { if (confirmed) deleteTrack(track.id) })
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Canvas scroll container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto relative"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          style={{ cursor: activeTool === 'hand' ? 'grab' : activeTool === 'blade' ? 'crosshair' : activeTool === 'zoom' ? 'zoom-in' : 'default' }}
        >
          <canvas
            ref={canvasRef}
            className="block"
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onWheel={handleWheel}
            onContextMenu={(e) => {
              e.preventDefault()
              const cvs = canvasRef.current
              if (!cvs) return
              const rect = cvs.getBoundingClientRect()
              const mx = e.clientX - rect.left - LANE_LABEL_W
              const my = e.clientY - rect.top - RULER_H

              if (my < 0) {
                setCtxMenu({
                  x: e.clientX, y: e.clientY,
                  items: [
                    { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => useTimeline.getState().pasteAtPlayhead(), disabled: !getClipboard() },
                    { divider: true },
                    { label: 'Add Video Track', onClick: () => addTrack('video') },
                    { label: 'Add Audio Track', onClick: () => addTrack('audio') }
                  ]
                })
                return
              }

              // Hit-test caption blocks first
              if (captionEntries.length > 0) {
                const captionLaneIdx = videoTrackIndices.length + audioTrackCount
                const captionLaneY = captionLaneIdx * (TRACK_LANE_H + LANE_GAP)
                if (my >= captionLaneY && my <= captionLaneY + TRACK_LANE_H) {
                  const clickedCaption = captionEntries.find((entry) => {
                    const ex = entry.startMs * PIXELS_PER_MS
                    const ew = Math.max((entry.endMs - entry.startMs) * PIXELS_PER_MS, 4)
                    return mx >= ex && mx <= ex + ew
                  })
                  if (clickedCaption) {
                    useCaption.getState().selectEntry(clickedCaption.id)
                    setCtxMenu({
                      x: e.clientX, y: e.clientY,
                      items: [
                        { label: 'Edit Text', onClick: () => useCaption.getState().selectEntry(clickedCaption.id) },
                        { divider: true },
                        { label: 'Duplicate', onClick: () => useCaption.getState().duplicateEntry(clickedCaption.id) },
                        { label: 'Split at Playhead', onClick: () => {
                          const ph = useTimeline.getState().playheadMs
                          if (ph > clickedCaption.startMs && ph < clickedCaption.endMs) {
                            useCaption.getState().splitEntry(clickedCaption.id, ph)
                          }
                        }, disabled: !(useTimeline.getState().playheadMs > clickedCaption.startMs && useTimeline.getState().playheadMs < clickedCaption.endMs) },
                        { divider: true },
                        { label: 'Delete', shortcut: 'Del', danger: true, onClick: () => {
                          useConfirm.getState().show({
                            title: 'Delete Caption',
                            message: `Delete caption "${clickedCaption.text.slice(0, 40)}${clickedCaption.text.length > 40 ? '…' : ''}"?`,
                            variant: 'danger',
                            confirmLabel: 'Delete'
                          }).then((c) => { if (c) useCaption.getState().deleteEntry(clickedCaption.id) })
                        }}
                      ]
                    })
                    return
                  }
                }
              }

              // Hit-test clips
              const clickedClip = clips.find((clip) => {
                const laneIdx = videoTrackIndices.indexOf(clip.trackIndex)
                const clipY = (laneIdx >= 0 ? laneIdx : 0) * (TRACK_LANE_H + LANE_GAP)
                const clipX = clip.startMs * PIXELS_PER_MS
                const clipW = clip.durationMs * PIXELS_PER_MS
                return mx >= clipX && mx <= clipX + clipW && my >= clipY && my <= clipY + TRACK_LANE_H
              })

              if (clickedClip) {
                const isLocked = tracks.find((t) => t.index === clickedClip.trackIndex)?.locked ?? false
                selectClip(clickedClip.id)
                setCtxMenu({
                  x: e.clientX, y: e.clientY,
                  items: [
                    { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => { selectClip(clickedClip.id); useTimeline.getState().cutSelection() } },
                    { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => { selectClip(clickedClip.id); useTimeline.getState().copySelection() } },
                    { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => useTimeline.getState().pasteAtPlayhead(), disabled: !getClipboard() },
                    { divider: true },
                    { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: () => duplicateClip(clickedClip.id), disabled: isLocked },
                    { divider: true },
                    { label: 'Delete', shortcut: 'Del', danger: true, disabled: isLocked, onClick: () => deleteClip(clickedClip.id) },
                    { label: 'Ripple Delete', danger: true, disabled: isLocked, onClick: () => rippleDeleteClip(clickedClip.id) },
                    { label: 'Split at Playhead', shortcut: 'S', disabled: isLocked, onClick: () => splitClipAtPlayhead() },
                    { divider: true },
                    { label: 'Generate Captions', onClick: () => {
                      useCaption.getState().transcribeClip(clickedClip.id)
                    }},
                    { divider: true },
                    { label: 'Properties', onClick: () => selectClip(clickedClip.id) }
                  ]
                })
                return
              }

              // Empty track area
              setCtxMenu({
                x: e.clientX, y: e.clientY,
                items: [
                  { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => useTimeline.getState().pasteAtPlayhead(), disabled: !getClipboard() },
                  { divider: true },
                  { label: 'Add Video Track', onClick: () => addTrack('video') },
                  { label: 'Add Audio Track', onClick: () => addTrack('audio') }
                ]
              })
            }}
            onMouseMove={(e) => {
              const cvs = canvasRef.current
              if (!cvs) return
              const r = cvs.getBoundingClientRect()
              const mx = e.clientX - r.left - LANE_LABEL_W
              const my = e.clientY - r.top - RULER_H
              if (my < 0) { cvs.style.cursor = ''; return }

              // Trim cursors near clip edges (checked BEFORE playhead to avoid shadowing)
              for (const c of clips) {
                const cx = c.startMs * PIXELS_PER_MS
                const cw = c.durationMs * PIXELS_PER_MS
                const laneIdx = videoTrackIndices.indexOf(c.trackIndex)
                const cy = (laneIdx >= 0 ? laneIdx : 0) * (TRACK_LANE_H + LANE_GAP)
                if (my >= cy && my <= cy + TRACK_LANE_H && mx >= cx && mx <= cx + cw) {
                  if (mx - cx < 8) { cvs.style.cursor = 'w-resize'; return }
                  if (cx + cw - mx < 8) { cvs.style.cursor = 'e-resize'; return }
                  cvs.style.cursor = 'grab'; return
                }
              }
              // Grab cursor over audio track blocks
              for (let ai = 0; ai < audioTrackCount; ai++) {
                const audioLaneY = (videoTrackIndices.length + ai) * (TRACK_LANE_H + LANE_GAP)
                if (my >= audioLaneY && my <= audioLaneY + TRACK_LANE_H) {
                  const track = audioTracks[ai]
                  if (track) {
                    const ax = track.startMs * PIXELS_PER_MS
                    const aw = track.durationMs * PIXELS_PER_MS
                    if (mx >= ax && mx <= ax + aw) { cvs.style.cursor = 'grab'; return }
                  }
                  break
                }
              }
              // Trim cursors near caption/text block edges
              if (captionEntries.length > 0) {
                const capLaneY = (videoTrackIndices.length + audioTrackCount) * (TRACK_LANE_H + LANE_GAP)
                if (my >= capLaneY && my <= capLaneY + TRACK_LANE_H) {
                  for (const entry of captionEntries) {
                    const cx = entry.startMs * PIXELS_PER_MS
                    const cw = Math.max((entry.endMs - entry.startMs) * PIXELS_PER_MS, 4)
                    if (mx >= cx && mx <= cx + cw) {
                      if (mx - cx < 8) { cvs.style.cursor = 'w-resize'; return }
                      if (cx + cw - mx < 8) { cvs.style.cursor = 'e-resize'; return }
                      cvs.style.cursor = 'grab'; return
                    }
                  }
                }
              }

              // Playhead cursor — only if not hovering a clip/caption
              const nearPlayhead = Math.abs(mx - playheadMs * PIXELS_PER_MS) < 10
              if (nearPlayhead) { cvs.style.cursor = 'col-resize'; return }
              cvs.style.cursor = ''
            }}
          />

          {/* Time display */}
          <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 tabular-nums pointer-events-none">
            {formatTime(playheadMs)} / {formatTime(totalDurationMs)}
          </div>
        </div>
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

// ---------------------------------------------------------------------------
// Track header button
// ---------------------------------------------------------------------------

function TrackButton({
  active, activeColor, title, onClick, children
}: {
  active: boolean; activeColor: string; title: string
  onClick: () => void; children: React.ReactNode
}): JSX.Element {
  return (
    <button
      className={`w-4 h-4 flex items-center justify-center text-[9px] rounded transition-colors ${
        active ? activeColor : 'text-gray-700 hover:text-gray-400'
      }`}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawRuler(
  ctx: CanvasRenderingContext2D,
  w: number,
  offsetX: number,
  h: number,
  ppm: number,
  totalMs: number,
  markers: Array<{ timeMs: number; label: string; color: string }>
): void {
  ctx.fillStyle = '#14141a'
  ctx.fillRect(offsetX, 0, w - offsetX, h)

  ctx.strokeStyle = '#222'
  ctx.fillStyle = '#555'
  ctx.font = '9px Inter, system-ui, sans-serif'
  ctx.lineWidth = 1

  let intervalMs = 1000
  if (1 / ppm > 5) intervalMs = 5000
  if (1 / ppm > 20) intervalMs = 10000
  if (1 / ppm < 2) intervalMs = 500
  if (1 / ppm < 0.5) intervalMs = 100

  const endMs = Math.max(totalMs, 30000)
  for (let ms = 0; ms <= endMs; ms += intervalMs) {
    const x = offsetX + ms * ppm
    if (x > w) break
    ctx.beginPath()
    ctx.moveTo(x, h - 6)
    ctx.lineTo(x, h)
    ctx.stroke()
    const label = ms >= 60000
      ? `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
      : `${ms / 1000}s`
    ctx.fillText(label, x + 2, h - 8)
  }

  // Draw timeline markers as colored diamonds on ruler
  for (const m of markers) {
    const x = offsetX + m.timeMs * ppm
    if (x < offsetX || x > w) continue
    ctx.save()
    ctx.fillStyle = m.color || '#FFD700'
    ctx.translate(x, h / 2)
    ctx.rotate(Math.PI / 4)
    ctx.fillRect(-4, -4, 8, 8)
    ctx.restore()
    if (m.label) {
      ctx.fillStyle = m.color || '#FFD700'
      ctx.font = '8px Inter, system-ui, sans-serif'
      ctx.fillText(m.label, x + 6, h - 4)
    }
  }
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: { id: string; startMs: number; durationMs: number; name?: string },
  offsetX: number,
  trackY: number,
  ppm: number,
  isSelected: boolean
): void {
  const x = offsetX + clip.startMs * ppm
  const w = Math.max(clip.durationMs * ppm, 4)
  const h = TRACK_LANE_H - 4
  const y = trackY + 2
  const r = 4

  ctx.save()
  ctx.fillStyle = isSelected ? '#3d3580' : '#2a2660'
  roundRect(ctx, x, y, w, h, r)
  ctx.fill()

  ctx.strokeStyle = isSelected ? '#534AB7' : '#3a3570'
  ctx.lineWidth = isSelected ? 2 : 1
  roundRect(ctx, x, y, w, h, r)
  ctx.stroke()

  if (w > 20) {
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    for (let i = 0; i < Math.floor(w / 6); i++) {
      ctx.fillRect(x + i * 6, y + 4, 3, h - 8)
    }
  }

  if (w > 30) {
    ctx.fillStyle = '#ddd'
    ctx.font = '10px Inter, system-ui, sans-serif'
    ctx.fillText(clip.name || 'Clip', x + 6, y + h / 2 + 4)
  }

  if (isSelected && w > 12) {
    const handleW = 6
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.fillRect(x, y, handleW, h)
    ctx.fillRect(x + w - handleW, y, handleW, h)
  }

  ctx.restore()
}

function drawAudioTrack(
  ctx: CanvasRenderingContext2D,
  track: { id: string; path: string; startMs: number; durationMs: number; volume: number; muted: boolean; name?: string },
  offsetX: number,
  trackY: number,
  ppm: number,
  maxW: number
): void {
  const x = offsetX + track.startMs * ppm
  const w = Math.max(track.durationMs * ppm, 40)
  const clipW = Math.min(w, maxW - x)
  const h = TRACK_LANE_H - 4
  const y = trackY + 2
  const r = 4

  if (clipW < 4) return

  ctx.save()
  ctx.fillStyle = track.muted ? '#151a16' : '#141e28'
  roundRect(ctx, x, y, clipW, h, r)
  ctx.fill()
  ctx.strokeStyle = track.muted ? '#1e2820' : '#1e3040'
  ctx.lineWidth = 1
  roundRect(ctx, x, y, clipW, h, r)
  ctx.stroke()

  // Draw waveform peaks — use real data when available, fall back to synthetic
  const waveform = getWaveform(track.path)
  const volH = h * track.volume

  if (waveform && waveform.length > 0) {
    // Real waveform: map peak array to pixel columns
    const peakCount = waveform.length
    const barW = Math.max(1, clipW / peakCount)
    ctx.fillStyle = track.muted ? '#2a3028' : '#2a4560'
    for (let i = 0; i < peakCount; i++) {
      const barH = waveform[i] * volH * 0.75 + 1
      const bx = x + i * (clipW / peakCount)
      ctx.fillRect(bx, y + h / 2 - barH / 2, Math.max(barW, 0.6), barH)
    }
  } else {
    // Fallback: synthetic pseudo-random bars (deterministic from track.id)
    ctx.fillStyle = track.muted ? '#2a3028' : '#2a4560'
    const barCount = Math.floor(clipW / 3)
    for (let i = 0; i < barCount; i++) {
      const seed = Math.sin(i * 12.9898 + track.id.charCodeAt(0)) * 43758.5453
      const barH = Math.abs(seed % 1) * volH * 0.7 + 2
      ctx.fillRect(x + i * 3, y + h / 2 - barH / 2, 2, barH)
    }
  }

  if (clipW > 40) {
    ctx.fillStyle = '#aaa'
    ctx.font = '10px Inter, system-ui, sans-serif'
    ctx.fillText(track.name || 'Audio', x + 4, y + h / 2 + 4)
  }

  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  if (w < 2 * r) r = w / 2
  if (h < 2 * r) r = h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

export default Timeline
