import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTimeline, pushUndoSnapshot, getClipboard, getStyleClipboard, computeEffectiveMuted, getInPoint, getOutPoint, type TimelineState, type Clip, type AudioTrack } from '../../store/useTimeline'
import { useCaption } from '../../store/useCaption'
import { useConfirm } from '../../store/useConfirm'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/index'
import { formatTime } from '../../utils/format'
import { getWaveform, extractWaveform } from '../../services/WaveformService'
import { useTimelineInteraction } from '../../timeline/useTimelineInteraction'
import { LAYOUT, hitTest, buildLaneLayout, computeBoxRect } from '../../timeline/interaction'
import { VolumeX, Headphones, Lock, EyeOff, Trash2 } from 'lucide-react'
import type { KeyframeTrack } from '../../effects/types/Keyframe'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveTool = 'select' | 'blade' | 'hand' | 'zoom'

interface TimelineProps {
  activeTool?: ActiveTool
}

// ---------------------------------------------------------------------------
// Timeline — thin render-only component
// ---------------------------------------------------------------------------

export function Timeline({ activeTool = 'select' }: TimelineProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ---- Interaction hook (owns all mouse/keyboard logic) ----
  const { handleMouseDown, handleMouseMove, handleClick, getMachine } =
    useTimelineInteraction(canvasRef as React.RefObject<HTMLCanvasElement>, containerRef as React.RefObject<HTMLDivElement>, activeTool)

  // ---- Store subscriptions (render-only) ----
  const { clips, audioTracks, tracks, markers, textClips, playheadMs, totalDurationMs, zoom, isPlaying, selectedIds, focusedId } =
    useTimeline(useShallow((s: TimelineState) => ({
      clips: s.clips, audioTracks: s.audioTracks, tracks: s.tracks, markers: s.markers,
      textClips: s.textClips, playheadMs: s.playheadMs, totalDurationMs: s.totalDurationMs,
      zoom: s.zoom, isPlaying: s.isPlaying, selectedIds: s.selectedIds, focusedId: s.focusedId
    })))

  const setZoom = useTimeline((s) => s.setZoom)
  const addTrack = useTimeline((s) => s.addTrack)
  const toggleMuteTrack = useTimeline((s) => s.toggleMuteTrack)
  const toggleSoloTrack = useTimeline((s) => s.toggleSoloTrack)
  const toggleLockTrack = useTimeline((s) => s.toggleLockTrack)
  const toggleHideTrack = useTimeline((s) => s.toggleHideTrack)
  const deleteTrack = useTimeline((s) => s.deleteTrack)
  const renameTrack = useTimeline((s) => s.renameTrack)
  const deleteClip = useTimeline((s) => s.deleteClip)
  const duplicateClip = useTimeline((s) => s.duplicateClip)
  const selectClip = useTimeline((s) => s.selectClip)
  const rippleDeleteClip = useTimeline((s) => s.rippleDeleteClip)
  const splitClipAtPlayhead = useTimeline((s) => s.splitClipAtPlayhead)
  const moveClip = useTimeline((s) => s.moveClip)
  const moveAudioTrack = useTimeline((s) => s.moveAudioTrack)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  const PIXELS_PER_MS = 0.1 * zoom
  const selectedIdSet = new Set<string>(selectedIds as string[])

  // ---- Lane layout ----

  const videoTrackCount = Math.max(
    1,
    ...tracks.filter((t) => t.kind === 'video').map((t) => t.index + 1),
    ...clips.map((c) => c.trackIndex + 1)
  )
  const videoTrackIndices = Array.from({ length: videoTrackCount }, (_, i) => i)

  const audioLaneCount = Math.max(
    audioTracks.reduce((m, t) => Math.max(m, t.trackIndex), 0) + 1,
    audioTracks.length > 0 ? 1 : 0,
    tracks.filter((t) => t.kind === 'audio').length
  )

  const captionLaneCount = textClips.length > 0 ? 1 : 0
  const totalLanes = videoTrackIndices.length + audioLaneCount + captionLaneCount
  const totalH = LAYOUT.RULER_H + totalLanes * (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)
  const timelineEndMs = Math.max(
    totalDurationMs,
    ...clips.map((c) => c.startMs + c.durationMs),
    ...audioTracks.map((t) => t.startMs + t.durationMs),
    ...textClips.map((t) => t.endMs)
  )
  const timelineContentW = Math.ceil(LAYOUT.LANE_LABEL_W + timelineEndMs * PIXELS_PER_MS + 320)

  // ---- Canvas rendering (RAF-throttled) ----

  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current) }

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const w = Math.max(container.clientWidth, timelineContentW, 400)
      const h = Math.max(container.clientHeight, totalH)
      canvas.width = w
      canvas.height = h

      ctx.fillStyle = '#0e0e12'
      ctx.fillRect(0, 0, w, h)

      drawRuler(ctx, w, LAYOUT.LANE_LABEL_W, LAYOUT.RULER_H, PIXELS_PER_MS, totalDurationMs, markers)

      // Track backgrounds
      for (let i = 0; i < totalLanes; i++) {
        const y = LAYOUT.RULER_H + i * (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)
        ctx.fillStyle = i % 2 === 0 ? '#101014' : '#121218'
        ctx.fillRect(LAYOUT.LANE_LABEL_W, y, w - LAYOUT.LANE_LABEL_W, LAYOUT.TRACK_LANE_H)
      }

      // Video clips
      const viewStartMs = (container.scrollLeft - LAYOUT.LANE_LABEL_W - 200) / PIXELS_PER_MS
      const viewEndMs = (container.scrollLeft + container.clientWidth) / PIXELS_PER_MS
      clips.forEach((clip) => {
        if (clip.startMs + clip.durationMs < viewStartMs || clip.startMs > viewEndMs) return
        const laneIdx = videoTrackIndices.indexOf(clip.trackIndex)
        const y = LAYOUT.RULER_H + (laneIdx >= 0 ? laneIdx : 0) * (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)
        const isHidden = tracks.find((t) => t.index === clip.trackIndex)?.hidden ?? false
        if (!isHidden) {
          const isSel = selectedIdSet.has(clip.id)
          drawClip(ctx, clip, LAYOUT.LANE_LABEL_W, y, PIXELS_PER_MS, isSel)

          // Keyframe diamond overlay — show on all clips, brighter for selected
          if (clip.keyframes && clip.keyframes.length > 0) {
            drawKeyframeDiamonds(ctx, clip.keyframes, clip.startMs, clip.durationMs, LAYOUT.LANE_LABEL_W, y, PIXELS_PER_MS, isSel ? 1.0 : 0.4)
          }

          // Transition icon at clip out-point
          if (clip.outTransition) {
            const outX = LAYOUT.LANE_LABEL_W + (clip.startMs + clip.durationMs) * PIXELS_PER_MS
            const transW = Math.max(clip.outTransition.durationMs * PIXELS_PER_MS, 6)
            const transH = LAYOUT.TRACK_LANE_H - 8
            const transY = y + 4
            ctx.fillStyle = 'rgba(168, 85, 247, 0.4)'
            ctx.fillRect(outX - transW, transY, transW, transH)
            ctx.fillStyle = '#a855f7'
            ctx.font = '9px Inter, system-ui'
            ctx.fillText('◇', outX - transW / 2 - 3, transY + transH / 2 + 3)
          }
        }
      })

      // Audio tracks — grouped by trackIndex (multiple clips can share a lane)
      const sortedAudioIndices = [...new Set<number>(audioTracks.map((t) => t.trackIndex))].sort((a, b) => a - b)
      for (let li = 0; li < audioLaneCount; li++) {
        const laneIdx = li < sortedAudioIndices.length ? sortedAudioIndices[li] : li
        const audioLaneY = LAYOUT.RULER_H + (videoTrackIndices.length + li) * (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)
        const laneTracks = audioTracks.filter((t) => t.trackIndex === laneIdx)
        for (const track of laneTracks) {
          if (track.startMs + track.durationMs < viewStartMs || track.startMs > viewEndMs) continue
          const effMuted = computeEffectiveMuted(track.muted, track.trackIndex, tracks)
          drawAudioTrack(ctx, track, LAYOUT.LANE_LABEL_W, audioLaneY, PIXELS_PER_MS, w, selectedIdSet, effMuted)
        }
      }

      // Caption blocks
      if (textClips.length > 0) {
        const captionLaneY = LAYOUT.RULER_H + (videoTrackIndices.length + audioLaneCount) * (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)
        for (const entry of textClips) {
          if (entry.endMs < viewStartMs || entry.startMs > viewEndMs) continue
          const bx = LAYOUT.LANE_LABEL_W + entry.startMs * PIXELS_PER_MS
          const bw = Math.max((entry.endMs - entry.startMs) * PIXELS_PER_MS, 4)
          const by = captionLaneY + 2
          const bh = LAYOUT.TRACK_LANE_H - 4
          const isCapSel = selectedIdSet.has(entry.id)

          ctx.save()
          ctx.fillStyle = isCapSel ? '#5b21b6' : '#3b1578'
          roundRect(ctx, bx, by, bw, bh, 3)
          ctx.fill()
          ctx.strokeStyle = isCapSel ? '#8b5cf6' : '#4c1d95'
          ctx.lineWidth = isCapSel ? 2 : 1
          roundRect(ctx, bx, by, bw, bh, 3)
          ctx.stroke()

          // Fade edge triangles
          drawFadeEdges(ctx, bx, by, bw, bh, entry.fadeInMs ?? 0, entry.fadeOutMs ?? 0, PIXELS_PER_MS, isCapSel)

          if (bw > 24) {
            ctx.fillStyle = '#e0d0ff'
            ctx.font = '11px Inter, system-ui, sans-serif'
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
      const px = LAYOUT.LANE_LABEL_W + playheadMs * PIXELS_PER_MS
      if (px >= LAYOUT.LANE_LABEL_W && px <= w) {
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
        ctx.fillRect(LAYOUT.LANE_LABEL_W, 0, w - LAYOUT.LANE_LABEL_W, LAYOUT.RULER_H)
      }

      // Box-select visualization
      const machine = getMachine()
      const bs = machine.as('box-selecting')
      if (bs && canvas) {
        const canvasRect = canvas.getBoundingClientRect()
        const box = computeBoxRect(bs.startClientX, bs.startClientY, bs.currentClientX, bs.currentClientY, canvasRect)
        ctx.save()
        ctx.strokeStyle = 'rgba(83, 74, 183, 0.8)'
        ctx.fillStyle = 'rgba(83, 74, 183, 0.1)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 2])
        ctx.beginPath()
        ctx.rect(LAYOUT.LANE_LABEL_W + box.x1, LAYOUT.RULER_H + box.y1, box.x2 - box.x1, box.y2 - box.y1)
        ctx.fill()
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }

      // Snap-line visual indicator during drag
      const dm = machine.as('dragging')
      if (dm && dm.snappedTo) {
        const sx = LAYOUT.LANE_LABEL_W + dm.snappedTo.timeMs * PIXELS_PER_MS
        ctx.save()
        ctx.strokeStyle = 'rgba(83, 74, 183, 0.7)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 3])
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }
    })

    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
  }, [clips, audioTracks, tracks, markers, textClips, playheadMs, totalDurationMs, zoom, selectedIds, focusedId,
    PIXELS_PER_MS, totalH, timelineContentW, videoTrackIndices, totalLanes, activeTool, getMachine])

  // ---- Auto-scroll to keep playhead in view during playback ----

  useEffect(() => {
    const container = containerRef.current
    if (!container || !isPlaying) return
    const px = LAYOUT.LANE_LABEL_W + playheadMs * PIXELS_PER_MS
    const containerW = container.clientWidth
    if (px > container.scrollLeft + containerW * 0.8) {
      container.scrollLeft = px - containerW * 0.2
    }
  }, [playheadMs, PIXELS_PER_MS, isPlaying])

  // ---- Auto-scroll to keep playhead in view on keyboard seek (when paused) ----

  useEffect(() => {
    const container = containerRef.current
    if (!container || isPlaying) return
    const px = LAYOUT.LANE_LABEL_W + playheadMs * PIXELS_PER_MS
    if (px < container.scrollLeft || px > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = px - container.clientWidth / 2
    }
  }, [playheadMs, PIXELS_PER_MS, isPlaying])

  // ---- Trigger waveform extraction ----

  useEffect(() => {
    for (const track of audioTracks) {
      if (track.path) extractWaveform(track.path)
    }
  }, [audioTracks])

  // ---- Native non-passive wheel listener so e.preventDefault() works ----
  // React's synthetic onWheel is passive by default in modern browsers, which
  // means calling e.preventDefault() inside it has no effect. We attach the
  // real DOM listener with { passive: false } so we can block the browser's
  // default scroll/zoom and take full control of the timeline scroll behavior.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        // Zoom — delegate to the interaction hook's zoom logic by dispatching
        // a synthetic React event is complex; instead replicate it here directly.
        const { zoom } = useTimeline.getState()
        const canvas = canvasRef.current
        if (canvas) {
          const rect = canvas.getBoundingClientRect()
          const mouseX = e.clientX - rect.left - LAYOUT.LANE_LABEL_W
          const ppm = 0.1 * zoom
          const timeUnderCursor = mouseX / ppm
          const factor = e.deltaY > 0 ? 0.85 : 1.15
          const newZoom = Math.max(0.02, Math.min(10, zoom * factor))
          const newPPM = 0.1 * newZoom
          const newScrollLeft = timeUnderCursor * newPPM - mouseX + LAYOUT.LANE_LABEL_W
          container.scrollLeft = Math.max(0, newScrollLeft)
          useTimeline.getState().setZoom(newZoom)
        }
      } else if (e.shiftKey) {
        container.scrollLeft += e.deltaY
      } else {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        container.scrollLeft += delta
      }
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => { container.removeEventListener('wheel', onWheel) }
  }, [canvasRef, containerRef])

  // ---- HTML5 drop target ----

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/clipzu-media') ||
        e.dataTransfer.types.includes('application/clipzu-media-batch')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move'
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const dropMs = Math.max(0, (e.clientX - rect.left - LAYOUT.LANE_LABEL_W) / PIXELS_PER_MS)

      // Calculate audio lane index from drop Y position
      const dropY = e.clientY - rect.top - LAYOUT.RULER_H
      const audioLaneIdx = Math.max(0, Math.floor(
        (dropY - videoTrackIndices.length * (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)) /
        (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)
      ))
      const ts = Date.now()

      // ---- Unified batch path: multi-select from MediaPanel OR single-item ----
      // Both MediaPanel and AudioPanel set 'application/clipzu-media'.
      // MediaPanel also sets 'application/clipzu-media-batch'.
      // We prioritize batch to prevent dual-path execution (duplication bug).
      let items: Array<{
        path: string; durationMs: number; width: number; height: number
        hasAudio: boolean; name: string; isAudio: boolean; isSfx?: boolean
      }> | null = null

      const batchRaw = e.dataTransfer.getData('application/clipzu-media-batch')
      if (batchRaw) {
        try {
          const parsed = JSON.parse(batchRaw)
          if (Array.isArray(parsed) && parsed.length > 0) {
            items = parsed
          }
        } catch {
          // Batch parse failed — return immediately to prevent fall-through duplication
          return
        }
      }

      if (!items) {
        const raw = e.dataTransfer.getData('application/clipzu-media')
        if (!raw) return
        try {
          const data = JSON.parse(raw)

          // Internal timeline drag (repositioning existing clip/audio)
          if (data.id && data.kind) {
            if (data.kind === 'clip') {
              const clip = clips.find((c: Clip) => c.id === data.id)
              if (clip) moveClip(data.id, Math.round(dropMs))
            } else if (data.kind === 'audio') {
              const track = audioTracks.find((a: AudioTrack) => a.id === data.id)
              if (track) moveAudioTrack(data.id, Math.max(0, dropMs))
            }
            return
          }

          // Single-item external import (AudioPanel SFX or single MediaPanel item)
          if (data.path) {
            items = [{
              path: data.path, durationMs: data.durationMs ?? 0,
              width: data.width ?? 0, height: data.height ?? 0,
              hasAudio: data.hasAudio ?? true, name: data.name ?? 'Media',
              isAudio: data.isAudio ?? false, isSfx: data.isSfx ?? false
            }]
          }
        } catch { return }
      }

      if (!items || items.length === 0) return

      // Build batch arrays and add via unified addMediaBatch
      const batchClips: Array<{
        id: string; path: string; startMs: number; sourceDurationMs: number; durationMs: number
        trackIndex: number; trimStart: number; trimEnd: number; name?: string
        hasAudio?: boolean; speed: number; volume: number; muted: boolean
      }> = []
      const batchAudio: Array<{
        id: string; path: string; startMs: number; sourceDurationMs: number; durationMs: number
        volume: number; muted: boolean; name?: string; role: 'voice' | 'music' | 'sfx' | 'ambient'
        trimStart: number; trimEnd: number; trackIndex: number
      }> = []

      items.forEach((item, i) => {
        const itemDropMs = Math.round(dropMs + i * 200)
        const rand = Math.random().toString(36).slice(2, 6)
        if (item.isAudio) {
          batchAudio.push({
            id: `audio_${ts}_${i}_${rand}`,
            path: item.path,
            startMs: itemDropMs,
            sourceDurationMs: item.durationMs ?? 0,
            durationMs: item.durationMs ?? 0,
            volume: 1, muted: false,
            name: item.name ?? 'Audio',
            role: item.isSfx ? 'sfx' : 'music',
            trimStart: 0, trimEnd: 0,
            trackIndex: audioLaneIdx
          })
        } else {
          batchClips.push({
            id: `clip_${ts}_${i}_${rand}`,
            path: item.path,
            startMs: itemDropMs,
            sourceDurationMs: item.durationMs ?? 0,
            durationMs: item.durationMs ?? 0,
            trackIndex: 0, trimStart: 0, trimEnd: 0,
            name: item.name ?? 'Clip',
            hasAudio: item.hasAudio ?? true,
            speed: 1.0, volume: 1, muted: false
          })
        }
      })

      useTimeline.getState().addMediaBatch(batchClips, batchAudio)
      // Auto-select the first newly added item
      const firstId = batchClips[0]?.id ?? batchAudio[0]?.id
      if (firstId) useTimeline.getState().selectClip(firstId)
    },
    [clips, audioTracks, tracks, PIXELS_PER_MS, moveClip, moveAudioTrack]
  )

  // ---- Build DOM track headers ----

  const allLanes: Array<{ kind: 'video' | 'audio' | 'caption'; index: number; trackId: string; name: string }> = [
    ...videoTrackIndices.map((ti) => {
      const t = tracks.find((tr) => tr.index === ti && tr.kind === 'video')
      return { kind: 'video' as const, index: ti, trackId: t?.id ?? `track_v${ti}`, name: t?.name ?? `Video ${ti + 1}` }
    }),
    ...Array.from({ length: audioLaneCount }, (_, i) => {
      const t = tracks.find((tr) => tr.kind === 'audio' && tr.index === i)
      return { kind: 'audio' as const, index: i, trackId: t?.id ?? `audio_track_${i}`, name: t?.name ?? `Audio ${i + 1}` }
    })
  ]
  if (textClips.length > 0) {
    allLanes.push({ kind: 'caption', index: 0, trackId: 'caption_track', name: 'Captions' })
  }

  // ---- Double-click handler (rename clip/audio) ----

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - LAYOUT.LANE_LABEL_W
    const st = useTimeline.getState()
    const ppm = 0.1 * st.zoom
    const lanes = buildLaneLayout(st.tracks, st.clips, st.audioTracks, st.textClips)
    const hit = hitTest(x, e.clientY - rect.top, ppm, st.playheadMs, lanes, st.clips, st.audioTracks, st.textClips)

    if (hit.kind === 'clip-body' || hit.kind === 'audio-body') {
      const entity = hit.kind === 'clip-body'
        ? st.clips.find((c) => c.id === hit.id)
        : st.audioTracks.find((a) => a.id === hit.id)
      if (entity) {
        const newName = window.prompt('Rename:', entity.name || '')
        if (newName?.trim()) {
          useTimeline.setState((s) => {
            if (hit.kind === 'clip-body') {
              const c = s.clips.find((cc) => cc.id === hit.id)
              if (c) c.name = newName.trim()
            } else {
              const a = s.audioTracks.find((aa) => aa.id === hit.id)
              if (a) a.name = newName.trim()
            }
          })
        }
      }
    }
  }, [])

  // ---- Context menu helper (uses same hit test engine as interactions) ----

  const showContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left - LAYOUT.LANE_LABEL_W
    const my = e.clientY - rect.top
    const st = useTimeline.getState()
    const ppm = 0.1 * st.zoom
    const lanes = buildLaneLayout(st.tracks, st.clips, st.audioTracks, st.textClips)
    const hit = hitTest(mx, my, ppm, st.playheadMs, lanes, st.clips, st.audioTracks, st.textClips)
    const captionEntries = st.textClips

    // Ruler context menu
    if (my < LAYOUT.RULER_H) {
      setCtxMenu({
        x: e.clientX, y: e.clientY,
        items: [
          { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => st.pasteAtPlayhead(), disabled: !getClipboard() },
          { divider: true },
          { label: 'Add Video Track', onClick: () => addTrack('video') },
          { label: 'Add Audio Track', onClick: () => addTrack('audio') }
        ]
      })
      return
    }

    // Caption hit
    if (hit.kind === 'caption-body' || hit.kind === 'caption-left-handle' || hit.kind === 'caption-right-handle') {
      const clickedCaption = captionEntries.find((ce) => ce.id === hit.id)
      if (clickedCaption) {
        useCaption.getState().selectEntry(clickedCaption.id)
        setCtxMenu({
          x: e.clientX, y: e.clientY,
          items: [
            { label: 'Edit Text', onClick: () => useCaption.getState().selectEntry(clickedCaption.id) },
            { divider: true },
            { label: 'Copy Style', onClick: () => { st.copyStyle() } },
            { label: 'Paste Style', disabled: !getStyleClipboard(), onClick: () => { st.pasteStyle() } },
            { divider: true },
            { label: 'Duplicate', onClick: () => useCaption.getState().duplicateEntry(clickedCaption.id) },
            { label: 'Split at Playhead', onClick: () => {
              const ph = st.playheadMs
              if (ph > clickedCaption.startMs && ph < clickedCaption.endMs) {
                useCaption.getState().splitEntry(clickedCaption.id, ph)
              }
            }, disabled: !(st.playheadMs > clickedCaption.startMs && st.playheadMs < clickedCaption.endMs) },
            { divider: true },
            { label: 'Delete', shortcut: 'Del', danger: true, onClick: () => {
              useConfirm.getState().show({
                title: 'Delete Caption',
                message: `Delete caption "${clickedCaption.text.slice(0, 40)}${clickedCaption.text.length > 40 ? '\u2026' : ''}"?`,
                variant: 'danger', confirmLabel: 'Delete'
              }).then((c) => { if (c) useCaption.getState().deleteEntry(clickedCaption.id) })
            }}
          ]
        })
        return
      }
    }

    // Audio track hit
    if (hit.kind === 'audio-body' || hit.kind === 'audio-left-handle' || hit.kind === 'audio-right-handle') {
      const clickedAudio = audioTracks.find((a) => a.id === hit.id)
      if (clickedAudio) {
        selectClip(clickedAudio.id)
        const setAudioRole = (role: 'music' | 'sfx' | 'voice') => {
          pushUndoSnapshot()
          useTimeline.setState((s) => { const t = s.audioTracks.find((a2) => a2.id === clickedAudio.id); if (t) t.role = role })
        }
        setCtxMenu({
          x: e.clientX, y: e.clientY,
          items: [
            { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => { st.cutSelection() } },
            { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => { st.copySelection() } },
            { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => st.pasteAtPlayhead(), disabled: !getClipboard() },
            { divider: true },
            { label: clickedAudio.muted ? '✓ Mute' : 'Mute', onClick: () => st.toggleAudioMute(clickedAudio.id) },
            { divider: true },
            { label: 'Delete', shortcut: 'Del', danger: true, onClick: () => {
              useTimeline.getState().removeAudioTrack(clickedAudio.id)
            }},
            { divider: true },
            { label: clickedAudio.role === 'music' ? '✓ Set as Music' : 'Set as Music', onClick: () => setAudioRole('music') },
            { label: clickedAudio.role === 'sfx' ? '✓ Set as SFX' : 'Set as SFX', onClick: () => setAudioRole('sfx') },
            { label: clickedAudio.role === 'voice' ? '✓ Set as Voice' : 'Set as Voice', onClick: () => setAudioRole('voice') },
            { divider: true },
            { label: 'Properties', onClick: () => selectClip(clickedAudio.id) }
          ]
        })
        return
      }
    }

    // Clip hit
    if (hit.kind === 'clip-body' || hit.kind === 'clip-left-handle' || hit.kind === 'clip-right-handle') {
      const clickedClip = clips.find((c) => c.id === hit.id)
      if (clickedClip) {
        const isLocked = tracks.find((t) => t.index === clickedClip.trackIndex)?.locked ?? false
        selectClip(clickedClip.id)
        const speedLabels: [number, string][] = [[0.25, '0.25x'], [0.5, '0.5x'], [1, '1x (Normal)'], [1.5, '1.5x'], [2, '2x'], [4, '4x']]
        const currentSpeed = clickedClip.speed ?? 1
        setCtxMenu({
          x: e.clientX, y: e.clientY,
          items: [
            { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => { st.cutSelection() } },
            { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => { st.copySelection() } },
            { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => st.pasteAtPlayhead(), disabled: !getClipboard() },
            { divider: true },
            { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: () => duplicateClip(clickedClip.id), disabled: isLocked },
            { label: 'Rename', onClick: () => {
              const newName = window.prompt('Clip name:', clickedClip.name ?? ''); if (newName?.trim()) st.setClipName(clickedClip.id, newName.trim())
            }},
            { divider: true },
            { label: 'Delete', shortcut: 'Del', danger: true, disabled: isLocked, onClick: () => deleteClip(clickedClip.id) },
            { label: 'Ripple Delete', danger: true, disabled: isLocked, onClick: () => rippleDeleteClip(clickedClip.id) },
            { label: 'Split at Playhead', shortcut: 'S', disabled: isLocked, onClick: () => splitClipAtPlayhead() },
            { label: '◇ Add Keyframe at Playhead', disabled: isLocked, onClick: () => st.addKeyframeAtPlayhead(clickedClip.id, 'opacity', 100) },
            { divider: true },
            { label: clickedClip.muted ? '✓ Mute Audio' : 'Mute Audio', onClick: () => st.setClipMute(clickedClip.id, !clickedClip.muted) },
            ...speedLabels.map(([speed, label]) => ({
              label: currentSpeed === speed ? `✓ ${label}` : label,
              onClick: () => st.setClipSpeed(clickedClip.id, speed)
            })),
            { divider: true },
            { label: 'Generate Captions', onClick: () => { useCaption.getState().transcribeClip(clickedClip.id) } },
            { divider: true },
            { label: 'Properties', onClick: () => selectClip(clickedClip.id) }
          ]
        })
        return
      }
    }

    // Empty track area
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => st.pasteAtPlayhead(), disabled: !getClipboard() },
        { divider: true },
        { label: 'Add Video Track', onClick: () => addTrack('video') },
        { label: 'Add Audio Track', onClick: () => addTrack('audio') }
      ]
    })
  }, [clips, tracks, audioTracks, addTrack, deleteClip, duplicateClip, rippleDeleteClip, selectClip, splitClipAtPlayhead])

  return (
    <div className="w-full h-full relative overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-0.5 bg-editor-panel border-b border-editor-border shrink-0">
        <div className="flex gap-1">
          <button className="text-[12px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-editor-surface"
            onClick={() => addTrack('video')}>+ Video</button>
          <button className="text-[12px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-editor-surface"
            onClick={() => addTrack('audio')}>+ Audio</button>
        </div>
        <div className="flex items-center gap-1">
          <button className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-300 text-xs rounded bg-editor-surface"
            onClick={() => setZoom(Math.max(0.02, zoom * 0.75))}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="7" width="12" height="2" /></svg>
          </button>
          <span className="text-[12px] text-gray-500 w-8 text-center tabular-nums">{(zoom * 100).toFixed(0)}%</span>
          <button className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-300 text-xs rounded bg-editor-surface"
            onClick={() => setZoom(Math.min(10, zoom * 1.33))}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="7" width="12" height="2" /><rect x="7" y="2" width="2" height="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Timeline body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Track header sidebar */}
        <div className="shrink-0 bg-editor-panel border-r border-editor-border flex flex-col"
          style={{ width: LAYOUT.LANE_LABEL_W, paddingTop: LAYOUT.RULER_H }}>
          {allLanes.map((lane, i) => {
            const track = tracks.find((t) => t.id === lane.trackId)
            return (
              <div key={`${lane.kind}-${lane.index}-${i}`}
                className="group flex items-center justify-between px-1 shrink-0 border-b border-editor-border/20"
                style={{ height: LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP, gap: 2 }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const t = tracks.find((tr) => tr.id === lane.trackId)
                  const setAudioRole = (role: 'music' | 'sfx' | 'voice') => {
                    pushUndoSnapshot()
                    useTimeline.setState((s) => { const at = s.audioTracks.find((a2) => a2.id === lane.trackId); if (at) at.role = role })
                  }
                  setCtxMenu({
                    x: e.clientX, y: e.clientY,
                    items: [
                      { label: 'Add Track Above', onClick: () => addTrack(lane.kind === 'caption' ? 'video' : lane.kind) },
                      { label: 'Add Track Below', onClick: () => addTrack(lane.kind === 'caption' ? 'video' : lane.kind) },
                      { divider: true },
                      { label: t?.muted ? '✓ Mute' : 'Mute', disabled: !t, onClick: () => { if (t) toggleMuteTrack(t.id) } },
                      { label: t?.solo ? '✓ Solo' : 'Solo', disabled: !t, onClick: () => { if (t) toggleSoloTrack(t.id) } },
                      { label: t?.locked ? '✓ Lock' : 'Lock', disabled: !t, onClick: () => { if (t) toggleLockTrack(t.id) } },
                      { label: t?.hidden ? '✓ Hide' : 'Hide', disabled: !t, onClick: () => { if (t) toggleHideTrack(t.id) } },
                      { divider: true },
                      { label: 'Generate Captions', disabled: lane.kind !== 'video' || clips.filter((c) => c.trackIndex === lane.index).length === 0,
                        onClick: () => { useCaption.getState().transcribeTrack(lane.index) } },
                      { divider: true },
                      { label: 'Set as Voice', disabled: lane.kind !== 'audio', onClick: () => setAudioRole('voice') },
                      { label: 'Set as Music', disabled: lane.kind !== 'audio', onClick: () => setAudioRole('music') },
                      { divider: true },
                      { label: 'Rename Track', onClick: () => {
                        if (t) { const newName = window.prompt('Track name:', t.name); if (newName?.trim()) renameTrack(t.id, newName.trim()) }
                      }, disabled: !t },
                      { label: 'Delete Track', danger: true, disabled: !t, onClick: () => {
                        if (t) useConfirm.getState().show({ title: 'Delete Track', message: `Delete track "${t.name}" and all clips on it? This cannot be undone.`, variant: 'danger', confirmLabel: 'Delete' }).then((c) => { if (c) deleteTrack(t.id) })
                      }}
                    ]
                  })
                }}
              >
                <span className="text-[12px] text-gray-500 truncate flex-1" title={lane.name}>{lane.name}</span>
                {track && (
                  <div className="flex gap-0.5">
                    <TrackButton active={!!track.muted} activeColor="text-yellow-400" title="Mute"
                      onClick={() => toggleMuteTrack(track.id)}><VolumeX size={12} /></TrackButton>
                    <TrackButton active={!!track.solo} activeColor="text-green-400" title="Solo"
                      onClick={() => toggleSoloTrack(track.id)}><Headphones size={12} /></TrackButton>
                    <TrackButton active={!!track.locked} activeColor="text-red-400" title="Lock"
                      onClick={() => toggleLockTrack(track.id)}><Lock size={12} /></TrackButton>
                    <TrackButton active={!!track.hidden} activeColor="text-gray-300" title="Hide"
                      onClick={() => toggleHideTrack(track.id)}><EyeOff size={12} /></TrackButton>
                    <button className="w-4 h-4 flex items-center justify-center text-[11px] rounded text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete track" onClick={() => {
                        useConfirm.getState().show({ title: 'Delete Track', message: `Delete track "${track.name}" and all clips on it? This cannot be undone.`, variant: 'danger', confirmLabel: 'Delete' }).then((c) => { if (c) deleteTrack(track.id) })
                      }}><Trash2 size={11} /></button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Canvas scroll container */}
        <div ref={containerRef} className="flex-1 overflow-auto relative"
          onDragOver={handleDragOver} onDrop={handleDrop}>
          <canvas ref={canvasRef} className="block"
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onContextMenu={showContextMenu}
            onDoubleClick={handleDoubleClick}
          />

          {/* Time display */}
          <div className="absolute bottom-1 right-2 text-[12px] text-gray-500 tabular-nums pointer-events-none">
            {formatTime(playheadMs)} / {formatTime(totalDurationMs)}
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {ctxMenu && <ContextMenu items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Track header button
// ---------------------------------------------------------------------------

const TrackButton = React.memo(function TrackButton({ active, activeColor, title, onClick, children }: {
  active: boolean; activeColor: string; title: string; onClick: () => void; children: React.ReactNode
}): JSX.Element {
  return (
    <button className={`w-4 h-4 flex items-center justify-center text-[11px] rounded transition-colors ${active ? activeColor : 'text-gray-700 hover:text-gray-400'}`}
      title={title} onClick={onClick}>{children}</button>
  )
})

// ---------------------------------------------------------------------------
// Drawing helpers (pure canvas, no state access)
// ---------------------------------------------------------------------------

function drawRuler(
  ctx: CanvasRenderingContext2D, w: number, offsetX: number, h: number, ppm: number, totalMs: number,
  markers: Array<{ timeMs: number; label: string; color: string }>
): void {
  ctx.fillStyle = '#14141a'
  ctx.fillRect(offsetX, 0, w - offsetX, h)
  ctx.strokeStyle = '#222'
  ctx.fillStyle = '#555'
  ctx.font = '11px Inter, system-ui, sans-serif'
  ctx.lineWidth = 1

  // Dynamic interval — target ~80-120px between major ticks (like proper video editors)
  const targetPx = 100
  const rawIntervalMs = targetPx / ppm
  const niceIntervals = [100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000]
  let intervalMs = niceIntervals[0]
  for (const ni of niceIntervals) {
    intervalMs = ni
    if (ni >= rawIntervalMs) break
  }
  const subTickCount = intervalMs >= 1000 ? 4 : 2  // minor ticks between major

  // Dynamic end — cover visible viewport and at least totalMs + 10% padding
  const visibleEndMs = (w - offsetX) / ppm
  const endMs = Math.max(totalMs * 1.1, visibleEndMs)

  for (let ms = 0; ms <= endMs; ms += intervalMs) {
    const x = offsetX + ms * ppm
    if (x > w) break

    // Major tick
    ctx.beginPath(); ctx.moveTo(x, h - 8); ctx.lineTo(x, h); ctx.stroke()

    // Timecode label: MM:SS (or MM:SS.ms at high zoom)
    let label: string
    if (intervalMs < 1000) {
      // High zoom: show MM:SS.ms
      const min = Math.floor(ms / 60000)
      const sec = Math.floor((ms % 60000) / 1000)
      const frac = Math.floor((ms % 1000) / 100)
      label = `${min}:${String(sec).padStart(2, '0')}.${frac}`
    } else {
      const min = Math.floor(ms / 60000)
      const sec = Math.floor((ms % 60000) / 1000)
      label = `${min}:${String(sec).padStart(2, '0')}`
    }
    ctx.fillText(label, x + 3, h - 10)

    // Sub-ticks
    if (subTickCount > 1) {
      const subStep = intervalMs / subTickCount
      for (let s = 1; s < subTickCount; s++) {
        const sx = offsetX + (ms + s * subStep) * ppm
        if (sx > w) break
        ctx.beginPath(); ctx.moveTo(sx, h - 4); ctx.lineTo(sx, h); ctx.stroke()
      }
    }
  }

  // Markers
  for (const m of markers) {
    const x = offsetX + m.timeMs * ppm
    if (x < offsetX || x > w) continue
    ctx.save()
    ctx.fillStyle = m.color || '#FFD700'
    ctx.translate(x, h / 2)
    ctx.rotate(Math.PI / 4)
    ctx.fillRect(-4, -4, 8, 8)
    ctx.restore()
    if (m.label) { ctx.fillStyle = m.color || '#FFD700'; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.fillText(m.label, x + 6, h - 4) }
  }

  // In/Out region highlight
  const inMs = getInPoint()
  const outMs = getOutPoint()
  if (inMs !== null && outMs !== null && inMs < outMs) {
    const ix = offsetX + inMs * ppm
    const ox = offsetX + outMs * ppm
    if (ox > offsetX && ix < w) {
      ctx.fillStyle = 'rgba(83, 74, 183, 0.08)'
      ctx.fillRect(Math.max(offsetX, ix), 0, Math.min(w, ox) - Math.max(offsetX, ix), h)
    }
  }
}

function drawFadeEdges(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  fadeInMs: number, fadeOutMs: number,
  ppm: number,
  selected: boolean = false
): void {
  const handleColor = selected ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)'
  const dotRadius = selected ? 3.5 : 2.5
  const lineW = selected ? 1.5 : 1

  if (fadeInMs > 0) {
    const fiw = Math.min(w * 0.4, fadeInMs * ppm)
    if (fiw > 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + fiw, y)
      ctx.lineTo(x, y + h)
      ctx.closePath()
      ctx.fill()

      // Handle indicator: vertical line + dot at inner edge
      const hx = x + fiw
      ctx.strokeStyle = handleColor
      ctx.lineWidth = lineW
      ctx.beginPath()
      ctx.moveTo(hx, y + 2)
      ctx.lineTo(hx, y + h - 2)
      ctx.stroke()
      ctx.fillStyle = handleColor
      ctx.beginPath()
      ctx.arc(hx, y + h / 2, dotRadius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (fadeOutMs > 0) {
    const fow = Math.min(w * 0.4, fadeOutMs * ppm)
    if (fow > 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.moveTo(x + w, y)
      ctx.lineTo(x + w - fow, y)
      ctx.lineTo(x + w, y + h)
      ctx.closePath()
      ctx.fill()

      // Handle indicator: vertical line + dot at inner edge
      const hx = x + w - fow
      ctx.strokeStyle = handleColor
      ctx.lineWidth = lineW
      ctx.beginPath()
      ctx.moveTo(hx, y + 2)
      ctx.lineTo(hx, y + h - 2)
      ctx.stroke()
      ctx.fillStyle = handleColor
      ctx.beginPath()
      ctx.arc(hx, y + h / 2, dotRadius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawClip(
  ctx: CanvasRenderingContext2D, clip: { id: string; startMs: number; durationMs: number; name?: string; fadeInMs?: number; fadeOutMs?: number },
  offsetX: number, trackY: number, ppm: number, isSelected: boolean
): void {
  const x = offsetX + clip.startMs * ppm
  const w = Math.max(clip.durationMs * ppm, 4)
  const h = LAYOUT.TRACK_LANE_H - 4
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

  // Fade edge triangles
  drawFadeEdges(ctx, x, y, w, h, clip.fadeInMs ?? 0, clip.fadeOutMs ?? 0, ppm, isSelected)

  if (w > 20) {
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    for (let i = 0; i < Math.floor(w / 6); i++) ctx.fillRect(x + i * 6, y + 4, 3, h - 8)
  }
  if (w > 30) {
    ctx.fillStyle = '#ddd'; ctx.font = '12px Inter, system-ui, sans-serif'
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
  track: { id: string; path: string; startMs: number; durationMs: number; volume: number; muted: boolean; name?: string; role?: string; fadeInMs?: number; fadeOutMs?: number },
  offsetX: number, trackY: number, ppm: number, maxW: number, selectedIdSet: Set<string>,
  effectiveMuted: boolean
): void {
  const x = offsetX + track.startMs * ppm
  const w = Math.max(track.durationMs * ppm, 40)
  const clipW = Math.min(w, maxW - x)
  const h = LAYOUT.TRACK_LANE_H - 4
  const y = trackY + 2
  const r = 4
  if (clipW < 4) return

  const isSel = selectedIdSet.has(track.id)

  // Role-based color coding
  const roleColors: Record<string, { bg: string; stroke: string; wave: string }> = {
    sfx:    { bg: '#261a10', stroke: '#3a2818', wave: '#5a3a20' },
    voice:  { bg: '#1a2614', stroke: '#283a1e', wave: '#3a5a2a' },
    ambient:{ bg: '#221428', stroke: '#3a1e3a', wave: '#4a2a5a' },
    music:  { bg: '#141e28', stroke: '#1e3040', wave: '#2a4560' }
  }
  const rc = roleColors[track.role || 'music']

  ctx.save()
  ctx.fillStyle = effectiveMuted ? '#151a16' : isSel ? '#2a3a50' : rc.bg
  roundRect(ctx, x, y, clipW, h, r)
  ctx.fill()
  ctx.strokeStyle = isSel ? '#534AB7' : effectiveMuted ? '#1e2820' : rc.stroke
  ctx.lineWidth = isSel ? 2 : 1
  roundRect(ctx, x, y, clipW, h, r)
  ctx.stroke()

  // Filled waveform silhouette — dual-peak envelope scaled to clip width
  const waveform = getWaveform(track.path)
  const halfH = h / 2
  const centerY = y + halfH
  const volH = halfH * track.volume
  if (waveform && waveform.max && waveform.max.length > 0) {
    const peakCount = waveform.max.length
    const pxPerPeak = clipW / peakCount
    ctx.fillStyle = effectiveMuted ? '#2a3028' : rc.wave
    ctx.beginPath()
    // Top envelope (left to right)
    ctx.moveTo(x, centerY)
    for (let i = 0; i < peakCount; i++) {
      const px = x + i * pxPerPeak
      const peakY = centerY - waveform.max[i] * volH
      ctx.lineTo(px, peakY)
    }
    // Bottom envelope (right to left, completing the filled shape)
    for (let i = peakCount - 1; i >= 0; i--) {
      const px = x + i * pxPerPeak
      const troughY = centerY - waveform.min[i] * volH
      ctx.lineTo(px, troughY)
    }
    ctx.closePath()
    ctx.fill()
  } else {
    // Fallback: synthetic bars when waveform data is unavailable
    ctx.fillStyle = effectiveMuted ? '#2a3028' : rc.wave
    const barCount = Math.floor(clipW / 3)
    for (let i = 0; i < barCount; i++) {
      const seed = Math.sin(i * 12.9898 + track.id.charCodeAt(0)) * 43758.5453
      const barH = Math.abs(seed % 1) * volH * 0.7 + 2
      ctx.fillRect(x + i * 3, centerY - barH / 2, 2, barH)
    }
  }

  if (clipW > 40) {
    ctx.fillStyle = '#aaa'; ctx.font = '12px Inter, system-ui, sans-serif'
    ctx.fillText(track.name || 'Audio', x + 4, y + h / 2 + 4)
  }

  // Fade edge triangles
  drawFadeEdges(ctx, x, y, clipW, h, track.fadeInMs ?? 0, track.fadeOutMs ?? 0, ppm, selectedIdSet.has(track.id))

  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

/** Draw small diamond markers at keyframe timecodes on a clip. */
function drawKeyframeDiamonds(
  ctx: CanvasRenderingContext2D,
  keyframes: KeyframeTrack[],
  clipStartMs: number,
  clipDurationMs: number,
  offsetX: number,
  trackY: number,
  ppm: number,
  opacity: number = 1.0
): void {
  const clipX = offsetX + clipStartMs * ppm
  const h = LAYOUT.TRACK_LANE_H - 4
  const y = trackY + 2
  const diamondSize = 4

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = '#a855f7'
  for (const track of keyframes) {
    for (const frame of track.frames) {
      const localTimeMs = frame.time
      if (localTimeMs < 0 || localTimeMs > clipDurationMs) continue
      const dx = clipX + localTimeMs * ppm
      const dy = y + h - diamondSize - 2
      // Draw diamond shape
      ctx.beginPath()
      ctx.moveTo(dx, dy - diamondSize)
      ctx.lineTo(dx + diamondSize, dy)
      ctx.lineTo(dx, dy + diamondSize)
      ctx.lineTo(dx - diamondSize, dy)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.restore()
}

export default Timeline
