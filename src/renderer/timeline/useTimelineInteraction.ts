// ---------------------------------------------------------------------------
// useTimelineInteraction — Coordinates InteractionMachine + Store + Canvas
// ---------------------------------------------------------------------------

import { useRef, useCallback, useEffect } from 'react'
import { useTimeline } from '../store/useTimeline'
import {
  InteractionMachine,
  hitTest,
  buildLaneLayout,
  computeSnapEdges,
  snapToEdges,
  computeBoxRect,
  findClipsInBox,
  getCursorForHit,
  LAYOUT,
  type HitTarget,
  type ModeState
} from './interaction'

export function useTimelineInteraction(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  containerRef: React.RefObject<HTMLDivElement>,
  activeTool: string
) {
  const machineRef = useRef(new InteractionMachine())

  // ---- Store accessors ----
  const setPlayhead = useTimeline((s) => s.setPlayhead)
  const setZoom = useTimeline((s) => s.setZoom)
  const moveClipLive = useTimeline((s) => s.moveClipLive)
  const trimClipLive = useTimeline((s) => s.trimClipLive)
  const updateTextClipLive = useTimeline((s) => s.updateTextClipLive)
  const moveAudioTrack = useTimeline((s) => s.moveAudioTrack)
  const beginDragCapture = useTimeline((s) => s.beginDragCapture)
  const commitDrag = useTimeline((s) => s.commitDrag)
  const cancelDrag = useTimeline((s) => s.cancelDrag)
  const selectClip = useTimeline((s) => s.selectClip)
  const selectTextClip = useTimeline((s) => s.selectTextClip)
  const deselectAll = useTimeline((s) => s.deselectAll)
  const toggleClipSelection = useTimeline((s) => s.toggleClipSelection)
  const selectClipRange = useTimeline((s) => s.selectClipRange)
  const toggleTextClipSelection = useTimeline((s) => s.toggleTextClipSelection)
  const selectTextClipRange = useTimeline((s) => s.selectTextClipRange)
  const splitClipAtPlayhead = useTimeline((s) => s.splitClipAtPlayhead)
  const selectBox = useTimeline((s) => s.selectBox)

  // ---- Refs for current state (avoid stale closures) ----
  const stateRef = useRef({
    zoom: 1,
    playheadMs: 0,
    totalDurationMs: 0,
    ppm: 0.1
  })

  // Sync state ref
  useEffect(() => {
    const unsub = useTimeline.subscribe((s) => {
      stateRef.current = {
        zoom: s.zoom,
        playheadMs: s.playheadMs,
        totalDurationMs: s.totalDurationMs,
        ppm: 0.1 * s.zoom
      }
    })
    return unsub
  }, [])

  // ---- Hit testing helper ----
  const doHitTest = useCallback((clientX: number, clientY: number): HitTarget => {
    const canvas = canvasRef.current
    if (!canvas) return { kind: 'empty' }
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left - LAYOUT.LANE_LABEL_W
    const { ppm, playheadMs } = stateRef.current
    const state = useTimeline.getState()
    const lanes = buildLaneLayout(state.tracks, state.clips, state.audioTracks, state.textClips)
    return hitTest(x, clientY - rect.top, ppm, playheadMs, lanes, state.clips, state.audioTracks, state.textClips)
  }, [canvasRef])

  // ---- Snap helper ----
  const doSnap = useCallback((rawMs: number, excludeIds: Set<string>): number => {
    const state = useTimeline.getState()
    const edges = computeSnapEdges(state.clips, state.audioTracks, state.textClips, state.markers, state.playheadMs)
    return snapToEdges(rawMs, edges, excludeIds, stateRef.current.ppm).snappedMs
  }, [])

  // ---- MouseDown handler ----
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const machine = machineRef.current
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    // Always abort any existing interaction before starting a new one
    machine.exit()

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - LAYOUT.LANE_LABEL_W
    const y = e.clientY - rect.top
    const { ppm, playheadMs, zoom } = stateRef.current

    // ---- Ruler ----
    if (y < LAYOUT.RULER_H) {
      const clickMs = Math.max(0, x / ppm)
      setPlayhead(clickMs)
      // Enter scrubbing mode on ruler drag (select tool) so user can drag to scrub
      if (activeTool === 'select') {
        machine.transition({ mode: 'scrubbing' }, (signal) => {
          window.addEventListener('mousemove', (ev) => {
            const canvasRect = canvasRef.current?.getBoundingClientRect()
            if (!canvasRect) return
            const mx = ev.clientX - canvasRect.left - LAYOUT.LANE_LABEL_W
            const newMs = Math.max(0, Math.min(stateRef.current.totalDurationMs, mx / stateRef.current.ppm))
            setPlayhead(newMs)
          }, { signal })
          window.addEventListener('mouseup', () => {
            machine.exit()
          }, { signal })
        })
      }
      return
    }

    // ---- Tool-specific ----
    if (activeTool === 'hand') {
      machine.transition(
        { mode: 'hand-scrolling', startClientX: e.clientX, startScrollLeft: container.scrollLeft },
        (signal) => {
          window.addEventListener('mousemove', (ev) => {
            const hs = machine.as('hand-scrolling')
            if (!hs) return
            container.scrollLeft = hs.startScrollLeft - (ev.clientX - hs.startClientX)
          }, { signal })
          window.addEventListener('mouseup', () => {
            machine.exit()
          }, { signal })
        }
      )
      return
    }

    if (activeTool === 'blade') {
      const clickMs = Math.max(0, x / ppm)
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

    if (activeTool !== 'select') return

    // ---- Hit test ----
    const state = useTimeline.getState()
    const lanes = buildLaneLayout(state.tracks, state.clips, state.audioTracks, state.textClips)
    const hit = hitTest(x, y, ppm, playheadMs, lanes, state.clips, state.audioTracks, state.textClips)

    // ---- Check locked track ----
    const isLocked = (trackIndex: number): boolean =>
      state.tracks.find((t) => t.index === trackIndex)?.locked ?? false

    switch (hit.kind) {
      case 'clip-left-handle':
      case 'clip-right-handle': {
        if (isLocked(hit.trackIndex)) return
        const clip = state.clips.find((c) => c.id === hit.id)
        if (!clip) return
        selectClip(hit.id)
        beginDragCapture()
        const mode: ModeState = {
          mode: hit.kind === 'clip-left-handle' ? 'trimming-left' : 'trimming-right',
          clipId: hit.id,
          clipKind: 'clip',
          startClientX: e.clientX,
          origTrimStart: clip.trimStart,
          origTrimEnd: clip.trimEnd,
          sourceDurationMs: clip.sourceDurationMs
        }
        machine.transition(mode, (signal) => {
          window.addEventListener('mousemove', (ev) => {
            const tm = machine.getTrim()
            if (!tm || tm.clipKind !== 'clip') return
            const dx = ev.clientX - tm.startClientX
            const deltaMs = dx / ppm
            if (tm.mode === 'trimming-left') {
              const maxTrim = tm.sourceDurationMs - tm.origTrimEnd - 100
              const newTrimStart = Math.max(0, Math.min(maxTrim, tm.origTrimStart + deltaMs))
              trimClipLive(tm.clipId, newTrimStart, tm.origTrimEnd)
            } else {
              const maxTrim = tm.sourceDurationMs - tm.origTrimStart - 100
              const newTrimEnd = Math.max(0, Math.min(maxTrim, tm.origTrimEnd - deltaMs))
              trimClipLive(tm.clipId, tm.origTrimStart, newTrimEnd)
            }
          }, { signal })
          window.addEventListener('mouseup', () => {
            commitDrag()
            machine.exit()
          }, { signal })
        }, () => { commitDrag() })
        return
      }

      case 'clip-body': {
        if (isLocked(hit.trackIndex)) return
        const clip = state.clips.find((c) => c.id === hit.id)
        if (!clip) return

        // Selection
        if (e.shiftKey) {
          selectClipRange(hit.id)
        } else if (e.ctrlKey || e.metaKey) {
          toggleClipSelection(hit.id)
        } else if (!state.selectedIds.includes(hit.id)) {
          selectClip(hit.id)
        }

        beginDragCapture()
        const selectedIds = useTimeline.getState().selectedIds.filter((id) =>
          state.clips.some((c) => c.id === id)
        )
        const isMultiDrag = selectedIds.length > 1 && selectedIds.includes(hit.id)
        const origins = new Map<string, { startMs: number; trackIndex: number }>()
        if (isMultiDrag) {
          for (const id of selectedIds) {
            const c = state.clips.find((cc) => cc.id === id)
            if (c) origins.set(id, { startMs: c.startMs, trackIndex: c.trackIndex })
          }
        } else {
          origins.set(hit.id, { startMs: clip.startMs, trackIndex: clip.trackIndex })
        }

        machine.transition(
          { mode: 'dragging', clipIds: [...origins.keys()], startClientX: e.clientX, startClientY: e.clientY, originPositions: origins, isAudio: false },
          (signal) => {
            window.addEventListener('mousemove', (ev) => {
              const dm = machine.as('dragging')
              if (!dm) return
              const canvasRect = canvasRef.current?.getBoundingClientRect()
              if (!canvasRect) return
              const dx = ev.clientX - canvasRect.left - LAYOUT.LANE_LABEL_W
              const dy = ev.clientY - canvasRect.top - LAYOUT.RULER_H
              const origin = dm.originPositions.get(dm.clipIds[0])
              if (!origin) return
              const rawMs = origin.startMs + (dx - (dm.startClientX - canvasRect.left - LAYOUT.LANE_LABEL_W)) / ppm
              const snappedMs = doSnap(rawMs, new Set(dm.clipIds))
              const deltaMs = snappedMs - origin.startMs
              const newTrackIndex = Math.max(0, Math.floor(dy / (LAYOUT.TRACK_LANE_H + LAYOUT.LANE_GAP)))
              const trackDelta = newTrackIndex - origin.trackIndex

              useTimeline.setState((st) => {
                for (const id of dm.clipIds) {
                  const c = st.clips.find((cc) => cc.id === id)
                  const orig = dm.originPositions.get(id)
                  if (c && orig) {
                    let newStart = Math.max(0, orig.startMs + deltaMs)
                    const newTrack = Math.max(0, orig.trackIndex + trackDelta)
                    // Same-track collision detection (Bug 3 fix)
                    const newEnd = newStart + c.durationMs
                    const blocker = st.clips.find(other =>
                      other.id !== id &&
                      other.trackIndex === newTrack &&
                      newStart < other.startMs + other.durationMs &&
                      newEnd > other.startMs
                    )
                    if (blocker) {
                      if (deltaMs > 0) {
                        newStart = Math.max(0, blocker.startMs - c.durationMs)
                      } else {
                        newStart = blocker.startMs + blocker.durationMs
                      }
                    }
                    c.startMs = newStart
                    c.trackIndex = newTrack
                  }
                }
                st.totalDurationMs = Math.max(...st.clips.map((c) => c.startMs + c.durationMs), 0)
              })
            }, { signal })
            window.addEventListener('mouseup', () => {
              commitDrag()
              machine.exit()
            }, { signal })
          },
          () => { commitDrag() }
        )
        return
      }

      case 'caption-left-handle':
      case 'caption-right-handle': {
        const tc = state.textClips.find((t) => t.id === hit.id)
        if (!tc) return
        selectTextClip(hit.id)
        beginDragCapture()
        const mode: ModeState = {
          mode: hit.kind === 'caption-left-handle' ? 'trimming-left' : 'trimming-right',
          clipId: hit.id,
          clipKind: 'text',
          startClientX: e.clientX,
          origTrimStart: 0,
          origTrimEnd: 0,
          sourceDurationMs: tc.durationMs,
          origStartMs: tc.startMs,
          origEndMs: tc.endMs,
          origWords: tc.words ? tc.words.map((w) => ({ ...w })) : undefined
        }
        machine.transition(mode, (signal) => {
          window.addEventListener('mousemove', (ev) => {
            const tm = machine.getTrim()
            if (!tm || tm.clipKind !== 'text') return
            const dx = ev.clientX - tm.startClientX
            const deltaMs = dx / ppm
            if (tm.mode === 'trimming-left') {
              const newStart = Math.max(0, (tm.origStartMs ?? 0) + deltaMs)
              if (newStart < (tm.origEndMs ?? 0) - 100) {
                updateTextClipLive(tm.clipId, {
                  startMs: newStart,
                  durationMs: (tm.origEndMs ?? 0) - newStart,
                  endMs: tm.origEndMs
                })
              }
            } else {
              const newEnd = Math.max((tm.origStartMs ?? 0) + 100, (tm.origEndMs ?? 0) + deltaMs)
              updateTextClipLive(tm.clipId, {
                endMs: newEnd,
                durationMs: newEnd - (tm.origStartMs ?? 0),
                startMs: tm.origStartMs
              })
            }
          }, { signal })
          window.addEventListener('mouseup', () => {
            commitDrag()
            machine.exit()
          }, { signal })
        }, () => { commitDrag() })
        return
      }

      case 'caption-body': {
        const tc = state.textClips.find((t) => t.id === hit.id)
        if (!tc) return

        if (e.shiftKey) {
          selectTextClipRange(hit.id)
        } else if (e.ctrlKey || e.metaKey) {
          toggleTextClipSelection(hit.id)
        } else if (!state.selectedIds.includes(hit.id)) {
          selectTextClip(hit.id)
        }

        beginDragCapture()
        const selectedIds = useTimeline.getState().selectedIds.filter((id) =>
          state.textClips.some((tc) => tc.id === id)
        )
        const isMultiDrag = selectedIds.length > 1 && selectedIds.includes(hit.id)
        const origins = new Map<string, { startMs: number; trackIndex: number }>()
        if (isMultiDrag) {
          for (const id of selectedIds) {
            const t = state.textClips.find((tt) => tt.id === id)
            if (t) origins.set(id, { startMs: t.startMs, trackIndex: t.trackIndex })
          }
        } else {
          origins.set(hit.id, { startMs: tc.startMs, trackIndex: tc.trackIndex })
        }

        machine.transition(
          { mode: 'dragging', clipIds: [...origins.keys()], startClientX: e.clientX, startClientY: e.clientY, originPositions: origins, isAudio: false },
          (signal) => {
            window.addEventListener('mousemove', (ev) => {
              const dm = machine.as('dragging')
              if (!dm) return
              const canvasRect = canvasRef.current?.getBoundingClientRect()
              if (!canvasRect) return
              const dx = ev.clientX - canvasRect.left - LAYOUT.LANE_LABEL_W
              const origin = dm.originPositions.get(dm.clipIds[0])
              if (!origin) return
              const deltaMs = (dx - (dm.startClientX - canvasRect.left - LAYOUT.LANE_LABEL_W)) / ppm

              for (const id of dm.clipIds) {
                const orig = dm.originPositions.get(id)
                if (!orig) continue
                const tc = state.textClips.find((t) => t.id === id)
                const durMs = tc ? tc.durationMs : 0
                const newStart = Math.max(0, orig.startMs + deltaMs)
                updateTextClipLive(id, { startMs: newStart, endMs: newStart + durMs, durationMs: durMs })
              }
            }, { signal })
            window.addEventListener('mouseup', () => {
              commitDrag()
              machine.exit()
            }, { signal })
          },
          () => { commitDrag() }
        )
        return
      }

      case 'audio-left-handle':
      case 'audio-right-handle': {
        const track = state.audioTracks.find((a) => a.id === hit.id)
        if (!track) return
        beginDragCapture()
        const mode: ModeState = {
          mode: hit.kind === 'audio-left-handle' ? 'trimming-left' : 'trimming-right',
          clipId: hit.id,
          clipKind: 'audio',
          startClientX: e.clientX,
          origTrimStart: track.startMs,
          origTrimEnd: track.startMs + track.durationMs,
          sourceDurationMs: track.durationMs
        }
        machine.transition(mode, (signal) => {
          window.addEventListener('mousemove', (ev) => {
            const tm = machine.getTrim()
            if (!tm || tm.clipKind !== 'audio') return
            const dx = ev.clientX - tm.startClientX
            const deltaMs = dx / ppm
            if (tm.mode === 'trimming-left') {
              const newStart = Math.max(0, tm.origTrimStart + deltaMs)
              if (newStart < tm.origTrimEnd - 100) {
                useTimeline.setState((st) => {
                  const a = st.audioTracks.find((at) => at.id === tm.clipId)
                  if (a) {
                    a.startMs = newStart
                    a.durationMs = tm.origTrimEnd - newStart
                  }
                })
              }
            } else {
              const newEnd = Math.max(tm.origTrimStart + 100, tm.origTrimEnd + deltaMs)
              useTimeline.setState((st) => {
                const a = st.audioTracks.find((at) => at.id === tm.clipId)
                if (a) { a.durationMs = newEnd - a.startMs }
              })
            }
          }, { signal })
          window.addEventListener('mouseup', () => {
            commitDrag()
            machine.exit()
          }, { signal })
        }, () => { commitDrag() })
        return
      }

      case 'audio-body': {
        const track = state.audioTracks.find((a) => a.id === hit.id)
        if (!track) return
        // Select audio track (sets focusedId so Inspector shows audio controls)
        if (e.shiftKey) {
          selectClip(hit.id)
        } else if (e.ctrlKey || e.metaKey) {
          // Toggle selection for audio tracks
          selectClip(hit.id)
        } else if (!state.selectedIds.includes(hit.id)) {
          selectClip(hit.id)
        }
        beginDragCapture()
        const origins = new Map<string, { startMs: number; trackIndex: number }>()
        origins.set(hit.id, { startMs: track.startMs, trackIndex: 0 })

        machine.transition(
          { mode: 'dragging', clipIds: [hit.id], startClientX: e.clientX, startClientY: e.clientY, originPositions: origins, isAudio: true },
          (signal) => {
            window.addEventListener('mousemove', (ev) => {
              const dm = machine.as('dragging')
              if (!dm) return
              const dx = ev.clientX - dm.startClientX
              const deltaMs = dx / ppm
              const origin = dm.originPositions.get(hit.id)
              if (origin) {
                moveAudioTrack(hit.id, Math.max(0, origin.startMs + deltaMs))
              }
            }, { signal })
            window.addEventListener('mouseup', () => {
              commitDrag()
              machine.exit()
            }, { signal })
          },
          () => { commitDrag() }
        )
        return
      }

      case 'playhead': {
        machine.transition({ mode: 'scrubbing' }, (signal) => {
          window.addEventListener('mousemove', (ev) => {
            const canvasRect = canvasRef.current?.getBoundingClientRect()
            if (!canvasRect) return
            const mx = ev.clientX - canvasRect.left - LAYOUT.LANE_LABEL_W
            const newMs = Math.max(0, Math.min(stateRef.current.totalDurationMs, mx / stateRef.current.ppm))
            setPlayhead(newMs)
          }, { signal })
          window.addEventListener('mouseup', () => {
            machine.exit()
          }, { signal })
        })
        return
      }

      case 'empty': {
        // Box select
        machine.transition(
          { mode: 'box-selecting', startClientX: e.clientX, startClientY: e.clientY, currentClientX: e.clientX, currentClientY: e.clientY },
          (signal) => {
            window.addEventListener('mousemove', (ev) => {
              const bs = machine.as('box-selecting')
              if (!bs) return
              bs.currentClientX = ev.clientX
              bs.currentClientY = ev.clientY
              // Trigger re-render for box visualization
              useTimeline.setState({})
            }, { signal })
            window.addEventListener('mouseup', (ev) => {
              const bs = machine.as('box-selecting')
              if (!bs) return
              const canvasRect = canvasRef.current?.getBoundingClientRect()
              if (!canvasRect) { machine.exit(); return }
              const box = computeBoxRect(bs.startClientX, bs.startClientY, ev.clientX, ev.clientY, canvasRect)
              const { ppm } = stateRef.current
              const st = useTimeline.getState()
              const lanes = buildLaneLayout(st.tracks, st.clips, st.audioTracks, st.textClips)
              const ids = findClipsInBox(box, ppm, lanes, st.clips, st.audioTracks, st.textClips)
              if (ids.length > 0) {
                selectBox(ids)
              } else {
                deselectAll()
              }
              machine.exit()
            }, { signal })
          }
        )
        return
      }
    }
  }, [
    canvasRef, containerRef, activeTool,
    setPlayhead, setZoom, moveClipLive, trimClipLive, updateTextClipLive,
    moveAudioTrack, beginDragCapture, commitDrag, cancelDrag,
    selectClip, selectTextClip, deselectAll,
    toggleClipSelection, selectClipRange,
    toggleTextClipSelection, selectTextClipRange,
    splitClipAtPlayhead, selectBox, doSnap
  ])

  // ---- Global cleanup: Escape, blur, unmount, tool switch ----
  useEffect(() => {
    const machine = machineRef.current
    const onEscape = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        if (!machine.isIdle) {
          cancelDrag()
          machine.exit()
        }
      }
    }
    const onBlur = (): void => {
      if (!machine.isIdle) {
        commitDrag()
        machine.exit()
      }
    }
    window.addEventListener('keydown', onEscape)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onEscape)
      window.removeEventListener('blur', onBlur)
      machine.exit()
    }
  }, [cancelDrag, commitDrag])

  // Abort on tool switch
  useEffect(() => {
    const machine = machineRef.current
    if (!machine.isIdle) {
      commitDrag()
      machine.exit()
    }
  }, [activeTool, commitDrag])

  // ---- Mouse move (cursor feedback) ----
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const hit = doHitTest(e.clientX, e.clientY)
    canvas.style.cursor = getCursorForHit(hit, activeTool)
  }, [canvasRef, doHitTest, activeTool])

  // ---- Click handler (for non-select tools) ----
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Only handle blade/zoom clicks — select tool uses mousedown
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - LAYOUT.LANE_LABEL_W
    if (x <= 0) return
    const { ppm, zoom } = stateRef.current
    const clickMs = Math.max(0, x / ppm)

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
    }
  }, [canvasRef, activeTool, setPlayhead, setZoom, splitClipAtPlayhead])

  // ---- Wheel handler ----
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) {
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left - LAYOUT.LANE_LABEL_W
        const { ppm, zoom } = stateRef.current
        const timeUnderCursor = mouseX / ppm
        const newZoom = Math.max(0.1, Math.min(10, zoom + (e.deltaY > 0 ? -0.1 : 0.1)))
        const newPPM = 0.1 * newZoom
        const newScrollLeft = timeUnderCursor * newPPM - mouseX + LAYOUT.LANE_LABEL_W
        container.scrollLeft = newScrollLeft
        setZoom(newZoom)
      }
    }
  }, [canvasRef, containerRef, setZoom])

  // ---- Expose machine for box-select rendering ----
  const getMachine = useCallback(() => machineRef.current, [])

  return {
    handleMouseDown,
    handleMouseMove,
    handleClick,
    handleWheel,
    getMachine
  }
}
