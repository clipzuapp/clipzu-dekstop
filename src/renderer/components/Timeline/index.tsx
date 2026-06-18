import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTimeline, getClipboard, getStyleClipboard, computeEffectiveMuted, type TimelineState } from '../../store/useTimeline'
import { useCaption } from '../../store/useCaption'
import { useConfirm } from '../../store/useConfirm'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/index'
import { formatTime } from '../../utils/format'
import { getWaveform, extractWaveform } from '../../services/WaveformService'
import { useTimelineInteraction } from '../../timeline/useTimelineInteraction'
import { LAYOUT, hitTest, buildLaneLayout, computeBoxRect } from '../../timeline/interaction'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveTool = 'select' | 'blade' | 'hand' | 'zoom'

interface TimelineProps {
  activeTool?: ActiveTool
}

// ---------------------------------------------------------------------------
// Timeline â€” thin render-only component
// ---------------------------------------------------------------------------

export function Timeline({ activeTool = 'select' }: TimelineProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ---- Interaction hook (owns all mouse/keyboard logic) ----
  const { handleMouseDown, handleMouseMove, handleClick, handleWheel, getMachine } =
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

      const w = Math.max(container.clientWidth, 400)
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
    })

    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
  }, [clips, audioTracks, tracks, markers, textClips, playheadMs, totalDurationMs, zoom, selectedIds, focusedId,
    PIXELS_PER_MS, totalH, videoTrackIndices, totalLanes, activeTool, getMachine])

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

  // ---- Trigger waveform extraction ----

  useEffect(() => {
    for (const track of audioTracks) {
      if (track.path) extractWaveform(track.path)
    }
  }, [audioTracks])

  // ---- HTML5 drop target ----

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/capcraft-media')) {
      e.preventDefault()
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
        const dropMs = Math.max(0, (e.clientX - rect.left - LAYOUT.LANE_LABEL_W) / PIXELS_PER_MS)

        if (data.path) {
          const ts = Date.now()
          const rand = Math.random().toString(36).slice(2, 6)

          // Calculate which audio lane the drop landed on
          const dropY = e.clientY - rect.top - LAYOUT.RULER_H
          const audioLaneIdx = Math.max(0, Math.floor((dropY - videoTrackIndices.length * (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)) / (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)))

          if (data.isAudio) {
            useTimeline.getState().addAudioTrack({
              id: `audio_${ts}_${rand}`, path: data.path, startMs: Math.round(dropMs),
              durationMs: data.durationMs ?? 0, volume: 1, muted: false,
              name: data.name ?? 'Audio', role: data.isSfx ? 'sfx' : 'music',
              trimStart: 0, trimEnd: 0, trackIndex: audioLaneIdx
            })
          } else {
            useTimeline.getState().addClip({
              id: `clip_${ts}_${rand}`, path: data.path, startMs: Math.round(dropMs),
              sourceDurationMs: data.durationMs ?? 0, durationMs: data.durationMs ?? 0,
              trackIndex: 0, trimStart: 0, trimEnd: 0,
              name: data.name ?? 'Clip', speed: 1.0
            })
          }
          return
        }

        const { id, kind } = data as { id: string; kind: 'clip' | 'audio' }
        if (kind === 'clip') {
          const clip = clips.find((c) => c.id === id)
          if (clip) moveClip(id, Math.round(dropMs))
        } else if (kind === 'audio') {
          const track = audioTracks.find((a) => a.id === id)
          if (track) moveAudioTrack(id, Math.max(0, dropMs))
        }
      } catch { /* invalid data */ }
    },
    [clips, audioTracks, PIXELS_PER_MS, moveClip, moveAudioTrack]
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
        setCtxMenu({
          x: e.clientX, y: e.clientY,
          items: [
            { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => { st.cutSelection() } },
            { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => { st.copySelection() } },
            { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => st.pasteAtPlayhead(), disabled: !getClipboard() },
            { divider: true },
            { label: 'Delete', shortcut: 'Del', danger: true, onClick: () => {
              useTimeline.getState().removeAudioTrack(clickedAudio.id)
            }},
            { divider: true },
            { label: 'Set as Music', onClick: () => {
              useTimeline.setState((s) => { const t = s.audioTracks.find((a2) => a2.id === clickedAudio.id); if (t) t.role = 'music' })
            }},
            { label: 'Set as SFX', onClick: () => {
              useTimeline.setState((s) => { const t = s.audioTracks.find((a2) => a2.id === clickedAudio.id); if (t) t.role = 'sfx' })
            }},
            { label: 'Set as Voice', onClick: () => {
              useTimeline.setState((s) => { const t = s.audioTracks.find((a2) => a2.id === clickedAudio.id); if (t) t.role = 'voice' })
            }},
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
        setCtxMenu({
          x: e.clientX, y: e.clientY,
          items: [
            { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => { st.cutSelection() } },
            { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => { st.copySelection() } },
            { label: 'Paste', shortcut: 'Ctrl+V', onClick: () => st.pasteAtPlayhead(), disabled: !getClipboard() },
            { divider: true },
            { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: () => duplicateClip(clickedClip.id), disabled: isLocked },
            { divider: true },
            { label: 'Delete', shortcut: 'Del', danger: true, disabled: isLocked, onClick: () => deleteClip(clickedClip.id) },
            { label: 'Ripple Delete', danger: true, disabled: isLocked, onClick: () => rippleDeleteClip(clickedClip.id) },
            { label: 'Split at Playhead', shortcut: 'S', disabled: isLocked, onClick: () => splitClipAtPlayhead() },
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
          <button className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-editor-surface"
            onClick={() => addTrack('video')}>+ Video</button>
          <button className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-editor-surface"
            onClick={() => addTrack('audio')}>+ Audio</button>
        </div>
        <div className="flex items-center gap-1">
          <button className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-300 text-xs rounded bg-editor-surface"
            onClick={() => setZoom(Math.max(0.1, zoom - 0.2))}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="7" width="12" height="2" /></svg>
          </button>
          <span className="text-[10px] text-gray-500 w-8 text-center tabular-nums">{(zoom * 100).toFixed(0)}%</span>
          <button className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-300 text-xs rounded bg-editor-surface"
            onClick={() => setZoom(Math.min(10, zoom + 0.2))}>
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
                  setCtxMenu({
                    x: e.clientX, y: e.clientY,
                    items: [
                      { label: 'Add Track Above', onClick: () => addTrack(lane.kind === 'caption' ? 'video' : lane.kind) },
                      { label: 'Add Track Below', onClick: () => addTrack(lane.kind === 'caption' ? 'video' : lane.kind) },
                      { divider: true },
                      { label: 'Generate Captions', disabled: lane.kind !== 'video' || clips.filter((c) => c.trackIndex === lane.index).length === 0,
                        onClick: () => { useCaption.getState().transcribeTrack(lane.index) } },
                      { divider: true },
                      { label: 'Set as Voice', disabled: lane.kind !== 'audio', onClick: () => {
                        const matched = audioTracks.find((a) => a.id === lane.trackId)
                        if (matched) useTimeline.setState((s) => { const t = s.audioTracks.find((a2) => a2.id === matched.id); if (t) t.role = 'voice' })
                      }},
                      { label: 'Set as Music', disabled: lane.kind !== 'audio', onClick: () => {
                        const matched = audioTracks.find((a) => a.id === lane.trackId)
                        if (matched) useTimeline.setState((s) => { const t = s.audioTracks.find((a2) => a2.id === matched.id); if (t) t.role = 'music' })
                      }},
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
                <span className="text-[10px] text-gray-500 truncate flex-1" title={lane.name}>{lane.name}</span>
                {track && (
                  <div className="flex gap-0.5">
                    <TrackButton active={!!track.muted} activeColor="text-yellow-400" title="Mute"
                      onClick={() => toggleMuteTrack(track.id)}>M</TrackButton>
                    <TrackButton active={!!track.solo} activeColor="text-green-400" title="Solo"
                      onClick={() => toggleSoloTrack(track.id)}>S</TrackButton>
                    <TrackButton active={!!track.locked} activeColor="text-red-400" title="Lock"
                      onClick={() => toggleLockTrack(track.id)}>L</TrackButton>
                    <TrackButton active={!!track.hidden} activeColor="text-gray-300" title="Hide"
                      onClick={() => toggleHideTrack(track.id)}>H</TrackButton>
                    <button className="w-4 h-4 flex items-center justify-center text-[9px] rounded text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete track" onClick={() => {
                        useConfirm.getState().show({ title: 'Delete Track', message: `Delete track "${track.name}" and all clips on it? This cannot be undone.`, variant: 'danger', confirmLabel: 'Delete' }).then((c) => { if (c) deleteTrack(track.id) })
                      }}>Ã—</button>
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
            onWheel={handleWheel}
            onContextMenu={showContextMenu}
          />

          {/* Time display */}
          <div className="absolute bottom-1 right-2 text-[10px] text-gray-500 tabular-nums pointer-events-none">
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
    <button className={`w-4 h-4 flex items-center justify-center text-[9px] rounded transition-colors ${active ? activeColor : 'text-gray-700 hover:text-gray-400'}`}
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
  ctx.font = '9px Inter, system-ui, sans-serif'
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
    if (m.label) { ctx.fillStyle = m.color || '#FFD700'; ctx.font = '8px Inter, system-ui, sans-serif'; ctx.fillText(m.label, x + 6, h - 4) }
  }
}

function drawClip(
  ctx: CanvasRenderingContext2D, clip: { id: string; startMs: number; durationMs: number; name?: string },
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

  if (w > 20) {
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    for (let i = 0; i < Math.floor(w / 6); i++) ctx.fillRect(x + i * 6, y + 4, 3, h - 8)
  }
  if (w > 30) {
    ctx.fillStyle = '#ddd'; ctx.font = '10px Inter, system-ui, sans-serif'
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

  ctx.save()
  ctx.fillStyle = effectiveMuted ? '#151a16' : isSel ? '#2a3a50' : '#141e28'
  roundRect(ctx, x, y, clipW, h, r)
  ctx.fill()
  ctx.strokeStyle = isSel ? '#534AB7' : effectiveMuted ? '#1e2820' : '#1e3040'
  ctx.lineWidth = isSel ? 2 : 1
  roundRect(ctx, x, y, clipW, h, r)
  ctx.stroke()

  const waveform = getWaveform(track.path)
  const volH = h * track.volume
  if (waveform && waveform.length > 0) {
    const peakCount = waveform.length
    const barW = Math.max(1, clipW / peakCount)
    ctx.fillStyle = effectiveMuted ? '#2a3028' : '#2a4560'
    for (let i = 0; i < peakCount; i++) {
      const barH = waveform[i] * volH * 0.75 + 1
      ctx.fillRect(x + i * (clipW / peakCount), y + h / 2 - barH / 2, Math.max(barW, 0.6), barH)
    }
  } else {
    ctx.fillStyle = effectiveMuted ? '#2a3028' : '#2a4560'
    const barCount = Math.floor(clipW / 3)
    for (let i = 0; i < barCount; i++) {
      const seed = Math.sin(i * 12.9898 + track.id.charCodeAt(0)) * 43758.5453
      const barH = Math.abs(seed % 1) * volH * 0.7 + 2
      ctx.fillRect(x + i * 3, y + h / 2 - barH / 2, 2, barH)
    }
  }

  if (clipW > 40) {
    ctx.fillStyle = '#aaa'; ctx.font = '10px Inter, system-ui, sans-serif'
    ctx.fillText(track.name || 'Audio', x + 4, y + h / 2 + 4)
  }
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

export default Timeline
