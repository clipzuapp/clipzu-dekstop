import { useRef, useCallback, useState, useEffect } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { useProject } from '../../store/useProject'
import { useSelectedEntity } from '../../store/useSelectedEntity'
import { getTextClipPercentBounds } from '../../utils/geometry'

// ---------------------------------------------------------------------------
// TransformOverlay — interactive DOM overlay for all transform operations.
//
// Unified owner for TextClip + Video Clip bounding boxes, crop handles,
// resize, rotation, and move. Shift-locks aspect ratio during resize.
//
// Features:
//  - Crop edge/corner handles for video clips
//  - Shift+corner = proportional scale lock (uniform scaleX/scaleY)
//  - Hover glow + scale-up on handles
//  - Dimension HUD during drag (scale %, rotation °, crop %)
// ---------------------------------------------------------------------------

type DragOp =
  | 'move' | 'rotate'
  | 'resize-ne' | 'resize-nw' | 'resize-se' | 'resize-sw'
  | 'crop-n' | 'crop-s' | 'crop-e' | 'crop-w'
  | 'crop-nw' | 'crop-ne' | 'crop-sw' | 'crop-se'

interface HudState {
  text: string
  x: number
  y: number
}

export function TransformOverlay(): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null)

  const { selectedClipId, selectedTextClipId } = useSelectedEntity()
  const clips = useTimeline((s) => s.clips)
  const textClips = useTimeline((s) => s.textClips)
  const updateTextClipLive = useTimeline((s) => s.updateTextClipLive)
  const setClipTransform = useTimeline((s) => s.setClipTransform)
  const beginDragCapture = useTimeline((s) => s.beginDragCapture)
  const commitDrag = useTimeline((s) => s.commitDrag)
  const cancelDrag = useTimeline((s) => s.cancelDrag)

  const pw = useProject((s) => s.resolution.width)
  const ph = useProject((s) => s.resolution.height)

  // Display-size ref (set on drag start for movementX/Y → % conversion)
  const displaySizeRef = useRef({ w: 1, h: 1 })
  const dragOffsetRef = useRef({ dx: 0, dy: 0 })

  // Shift-lock tracking
  const shiftRef = useRef(false)
  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => { if (e.key === 'Shift') shiftRef.current = true }
    const onUp = (e: KeyboardEvent): void => { if (e.key === 'Shift') shiftRef.current = false }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])

  // HUD state
  const [hud, setHud] = useState<HudState | null>(null)

  // Priority: TextClip > Video Clip (single owner model)
  const textClip = selectedTextClipId
    ? textClips.find((tc) => tc.id === selectedTextClipId) ?? null
    : null
  const clip = !textClip && selectedClipId
    ? clips.find((c) => c.id === selectedClipId) ?? null
    : null

  // Capture display dimensions on drag start
  const captureDisplaySize = useCallback(() => {
    const el = containerRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      displaySizeRef.current = { w: rect.width || 1, h: rect.height || 1 }
    }
  }, [])

  // ---- Video bounding box computation ----
  let videoBox: { left: number; top: number; width: number; height: number } | null = null
  if (clip?.transform) {
    const t = clip.transform
    videoBox = {
      left: ((pw / 2 + t.x - (pw * t.scaleX) / 2) / pw) * 100,
      top: ((ph / 2 + t.y - (ph * t.scaleY) / 2) / ph) * 100,
      width: t.scaleX * 100,
      height: t.scaleY * 100
    }
  }

  // ---- Text clip bounding box ----
  let textClipBox: { left: number; top: number; width: number; height: number } | null = null
  if (textClip?.style) {
    const s = textClip.style
    const bounds = getTextClipPercentBounds(
      textClip.text, s.fontFamily, s.fontSize, s.fontWeight, s.scale ?? 1, s.x, s.y, pw, ph
    )
    textClipBox = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
  }

  // ---- Shared clean-up factory for drag operations ----
  const makeCleanup = (
    onMoveRef: { current: ((ev: MouseEvent) => void) | null },
    onUp: () => void, onBlur: () => void, onKey: (ev: KeyboardEvent) => void
  ): (() => void) => {
    return () => {
      if (onMoveRef.current) window.removeEventListener('mousemove', onMoveRef.current)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
    }
  }

  // ========================================================================
  // TextClip drag (move, resize, rotate) — existing logic, polished
  // ========================================================================

  const startTextClipDrag = useCallback((op: DragOp, e: React.MouseEvent) => {
    if (!textClip?.style || !selectedTextClipId) return
    e.preventDefault()
    e.stopPropagation()
    captureDisplaySize()
    beginDragCapture()

    const style = textClip.style
    const startRotation = style.rotation ?? 0
    const startX = style.x
    const startY = style.y
    const boxCenterX = startX
    const boxCenterY = startY

    const onMoveRef = { current: null as ((ev: MouseEvent) => void) | null }
    const onUp = (): void => { commitDrag(); cleanup(); setHud(null) }
    const onBlur = (): void => { commitDrag(); cleanup(); setHud(null) }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { cancelDrag(); cleanup(); setHud(null) }
    }
    const cleanup = makeCleanup(onMoveRef, onUp, onBlur, onKey)

    if (op === 'move') {
      dragOffsetRef.current = { dx: 0, dy: 0 }
      onMoveRef.current = (ev: MouseEvent): void => {
        const dw = displaySizeRef.current.w
        const dh = displaySizeRef.current.h
        dragOffsetRef.current.dx += ev.movementX
        dragOffsetRef.current.dy += ev.movementY
        const newX = Math.max(0, Math.min(100, startX + (dragOffsetRef.current.dx / dw) * 100))
        const newY = Math.max(0, Math.min(100, startY + (dragOffsetRef.current.dy / dh) * 100))
        updateTextClipLive(selectedTextClipId, { style: { ...style, x: newX, y: newY } })
        setHud({ text: `X:${Math.round(newX)}%  Y:${Math.round(newY)}%`, x: ev.clientX + 16, y: ev.clientY - 24 })
      }
      window.addEventListener('mousemove', onMoveRef.current)
    } else if (op === 'rotate') {
      const dw = displaySizeRef.current.w
      const dh = displaySizeRef.current.h
      const startAngle = (ev: MouseEvent): number => {
        const el = containerRef.current
        if (!el) return 0
        const r = el.getBoundingClientRect()
        const mx = ((ev.clientX - r.left) / dw) * 100
        const my = ((ev.clientY - r.top) / dh) * 100
        return Math.atan2(my - boxCenterY, mx - boxCenterX) * (180 / Math.PI)
      }
      const baseAngle = startAngle(e.nativeEvent as unknown as MouseEvent)
      onMoveRef.current = (ev: MouseEvent): void => {
        const angle = startAngle(ev)
        let rot = startRotation + (angle - baseAngle)
        while (rot > 180) rot -= 360
        while (rot < -180) rot += 360
        updateTextClipLive(selectedTextClipId, { style: { ...style, rotation: rot } })
        setHud({ text: `${Math.round(rot)}°`, x: ev.clientX + 16, y: ev.clientY - 24 })
      }
      window.addEventListener('mousemove', onMoveRef.current)
    } else {
      // Corner resize
      const pairMap: Record<string, 'sw' | 'se' | 'ne' | 'nw'> = {
        'resize-ne': 'sw', 'resize-nw': 'se', 'resize-se': 'nw', 'resize-sw': 'ne'
      }
      const oppositeCorner = pairMap[op]
      let fixedX = boxCenterX
      let fixedY = boxCenterY
      if (!textClipBox) return
      if (oppositeCorner.includes('e')) fixedX = boxCenterX + textClipBox.width / 2
      else if (oppositeCorner.includes('w')) fixedX = boxCenterX - textClipBox.width / 2
      if (oppositeCorner.includes('s')) fixedY = boxCenterY + textClipBox.height / 2
      else if (oppositeCorner.includes('n')) fixedY = boxCenterY - textClipBox.height / 2

      onMoveRef.current = (ev: MouseEvent): void => {
        const el = containerRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const dw = r.width || 1
        const dh = r.height || 1
        const mx = ((ev.clientX - r.left) / dw) * 100
        const my = ((ev.clientY - r.top) / dh) * 100
        const dx = Math.abs(mx - fixedX)
        const dy = Math.abs(my - fixedY)
        const origW = textClipBox!.width
        const origH = textClipBox!.height
        const sX = origW > 0 ? dx / origW : 1
        const sY = origH > 0 ? dy / origH : 1
        const newScale = Math.max(0.1, Math.min(5, (sX + sY) / 2))
        updateTextClipLive(selectedTextClipId, { style: { ...style, scale: newScale } })
        setHud({ text: `${Math.round(newScale * 100)}%`, x: ev.clientX + 16, y: ev.clientY - 24 })
      }
      window.addEventListener('mousemove', onMoveRef.current)
    }

    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
  }, [textClip, textClipBox, selectedTextClipId, updateTextClipLive, beginDragCapture, commitDrag, cancelDrag, captureDisplaySize])

  // ========================================================================
  // Video clip crop drag — new CapCut-style crop handles
  // ========================================================================

  const startVideoCropDrag = useCallback((op: DragOp, e: React.MouseEvent) => {
    if (!clip?.transform || !selectedClipId) return
    e.preventDefault()
    e.stopPropagation()
    captureDisplaySize()
    beginDragCapture()

    const t = clip.transform
    const startCrop = { top: t.cropTop, bottom: t.cropBottom, left: t.cropLeft, right: t.cropRight }

    const onMoveRef = { current: null as ((ev: MouseEvent) => void) | null }
    const onUp = (): void => { commitDrag(); cleanup(); setHud(null) }
    const onBlur = (): void => { commitDrag(); cleanup(); setHud(null) }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { cancelDrag(); cleanup(); setHud(null) }
    }
    const cleanup = makeCleanup(onMoveRef, onUp, onBlur, onKey)

    onMoveRef.current = (ev: MouseEvent): void => {
      const el = containerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const dw = r.width || 1
      const dh = r.height || 1
      // Delta in percentage of canvas
      const dxPct = ((ev.movementX) / dw) * 100
      const dyPct = ((ev.movementY) / dh) * 100

      const partial: Partial<typeof t> = {}
      const shift = shiftRef.current // Shift-lock for proportional crop

      switch (op) {
        case 'crop-n':
          partial.cropTop = Math.max(0, Math.min(50, startCrop.top + dyPct))
          break
        case 'crop-s':
          partial.cropBottom = Math.max(0, Math.min(50, startCrop.bottom - dyPct))
          break
        case 'crop-w':
          partial.cropLeft = Math.max(0, Math.min(50, startCrop.left - dxPct))
          break
        case 'crop-e':
          partial.cropRight = Math.max(0, Math.min(50, startCrop.right + dxPct))
          break
        case 'crop-nw':
          partial.cropTop = Math.max(0, Math.min(50, startCrop.top + dyPct))
          partial.cropLeft = Math.max(0, Math.min(50, startCrop.left - dxPct))
          if (shift) {
            const avg = (partial.cropTop! + partial.cropLeft!) / 2
            partial.cropTop = avg; partial.cropLeft = avg
          }
          break
        case 'crop-ne':
          partial.cropTop = Math.max(0, Math.min(50, startCrop.top + dyPct))
          partial.cropRight = Math.max(0, Math.min(50, startCrop.right + dxPct))
          if (shift) {
            const avg = (partial.cropTop! + partial.cropRight!) / 2
            partial.cropTop = avg; partial.cropRight = avg
          }
          break
        case 'crop-sw':
          partial.cropBottom = Math.max(0, Math.min(50, startCrop.bottom - dyPct))
          partial.cropLeft = Math.max(0, Math.min(50, startCrop.left - dxPct))
          if (shift) {
            const avg = (partial.cropBottom! + partial.cropLeft!) / 2
            partial.cropBottom = avg; partial.cropLeft = avg
          }
          break
        case 'crop-se':
          partial.cropBottom = Math.max(0, Math.min(50, startCrop.bottom - dyPct))
          partial.cropRight = Math.max(0, Math.min(50, startCrop.right + dxPct))
          if (shift) {
            const avg = (partial.cropBottom! + partial.cropRight!) / 2
            partial.cropBottom = avg; partial.cropRight = avg
          }
          break
      }
      setClipTransform(selectedClipId, partial)

      const cropLabels: string[] = []
      if (partial.cropTop !== undefined) cropLabels.push(`T:${Math.round(partial.cropTop)}%`)
      if (partial.cropBottom !== undefined) cropLabels.push(`B:${Math.round(partial.cropBottom!)}%`)
      if (partial.cropLeft !== undefined) cropLabels.push(`L:${Math.round(partial.cropLeft!)}%`)
      if (partial.cropRight !== undefined) cropLabels.push(`R:${Math.round(partial.cropRight!)}%`)
      setHud({ text: cropLabels.join('  '), x: ev.clientX + 16, y: ev.clientY - 24 })
    }
    window.addEventListener('mousemove', onMoveRef.current)

    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
  }, [clip, selectedClipId, setClipTransform, beginDragCapture, commitDrag, cancelDrag, captureDisplaySize])

  // ========================================================================
  // Video clip resize via DOM (replaces canvas-only gizmo)
  // ========================================================================

  const startVideoResizeDrag = useCallback((op: DragOp, e: React.MouseEvent) => {
    if (!clip?.transform || !selectedClipId || !videoBox) return
    e.preventDefault()
    e.stopPropagation()
    captureDisplaySize()
    beginDragCapture()

    // Fixed opposite corner in percentage
    let fixedX = videoBox.left + videoBox.width / 2
    let fixedY = videoBox.top + videoBox.height / 2
    if (op === 'resize-ne') { fixedX = videoBox.left; fixedY = videoBox.top + videoBox.height }
    else if (op === 'resize-nw') { fixedX = videoBox.left + videoBox.width; fixedY = videoBox.top + videoBox.height }
    else if (op === 'resize-se') { fixedX = videoBox.left; fixedY = videoBox.top }
    else if (op === 'resize-sw') { fixedX = videoBox.left + videoBox.width; fixedY = videoBox.top }

    const onMoveRef = { current: null as ((ev: MouseEvent) => void) | null }
    const onUp = (): void => { commitDrag(); cleanup(); setHud(null) }
    const onBlur = (): void => { commitDrag(); cleanup(); setHud(null) }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { cancelDrag(); cleanup(); setHud(null) }
    }
    const cleanup = makeCleanup(onMoveRef, onUp, onBlur, onKey)

    onMoveRef.current = (ev: MouseEvent): void => {
      const el = containerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const dw = r.width || 1
      const dh = r.height || 1
      const mx = ((ev.clientX - r.left) / dw) * 100
      const my = ((ev.clientY - r.top) / dh) * 100
      const dx = Math.abs(mx - fixedX)
      const dy = Math.abs(my - fixedY)
      const origW = videoBox!.width
      const origH = videoBox!.height
      let sX = origW > 0 ? dx / origW : 1
      let sY = origH > 0 ? dy / origH : 1
      const shift = shiftRef.current
      if (shift) {
        // Proportional lock
        const avg = (sX + sY) / 2
        sX = avg; sY = avg
      }
      sX = Math.max(0.05, Math.min(5, sX))
      sY = Math.max(0.05, Math.min(5, sY))
      setClipTransform(selectedClipId, { scaleX: sX, scaleY: sY })
      setHud({ text: `${Math.round(sX * 100)}% × ${Math.round(sY * 100)}%`, x: ev.clientX + 16, y: ev.clientY - 24 })
    }
    window.addEventListener('mousemove', onMoveRef.current)

    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
  }, [clip, selectedClipId, videoBox, setClipTransform, beginDragCapture, commitDrag, cancelDrag, captureDisplaySize])

  // ---- Handler bindings ----
  const handleMoveDown = useCallback((e: React.MouseEvent) => startTextClipDrag('move', e), [startTextClipDrag])
  const handleResizeNW = useCallback((e: React.MouseEvent) => startTextClipDrag('resize-nw', e), [startTextClipDrag])
  const handleResizeNE = useCallback((e: React.MouseEvent) => startTextClipDrag('resize-ne', e), [startTextClipDrag])
  const handleResizeSW = useCallback((e: React.MouseEvent) => startTextClipDrag('resize-sw', e), [startTextClipDrag])
  const handleResizeSE = useCallback((e: React.MouseEvent) => startTextClipDrag('resize-se', e), [startTextClipDrag])
  const handleRotateDown = useCallback((e: React.MouseEvent) => startTextClipDrag('rotate', e), [startTextClipDrag])

  // Video resize handlers
  const handleVideoResizeNW = useCallback((e: React.MouseEvent) => startVideoResizeDrag('resize-nw', e), [startVideoResizeDrag])
  const handleVideoResizeNE = useCallback((e: React.MouseEvent) => startVideoResizeDrag('resize-ne', e), [startVideoResizeDrag])
  const handleVideoResizeSW = useCallback((e: React.MouseEvent) => startVideoResizeDrag('resize-sw', e), [startVideoResizeDrag])
  const handleVideoResizeSE = useCallback((e: React.MouseEvent) => startVideoResizeDrag('resize-se', e), [startVideoResizeDrag])

  // Video crop handlers
  const handleCropN  = useCallback((e: React.MouseEvent) => startVideoCropDrag('crop-n', e), [startVideoCropDrag])
  const handleCropS  = useCallback((e: React.MouseEvent) => startVideoCropDrag('crop-s', e), [startVideoCropDrag])
  const handleCropE  = useCallback((e: React.MouseEvent) => startVideoCropDrag('crop-e', e), [startVideoCropDrag])
  const handleCropW  = useCallback((e: React.MouseEvent) => startVideoCropDrag('crop-w', e), [startVideoCropDrag])
  const handleCropNW = useCallback((e: React.MouseEvent) => startVideoCropDrag('crop-nw', e), [startVideoCropDrag])
  const handleCropNE = useCallback((e: React.MouseEvent) => startVideoCropDrag('crop-ne', e), [startVideoCropDrag])
  const handleCropSW = useCallback((e: React.MouseEvent) => startVideoCropDrag('crop-sw', e), [startVideoCropDrag])
  const handleCropSE = useCallback((e: React.MouseEvent) => startVideoCropDrag('crop-se', e), [startVideoCropDrag])

  // ---- Shared handle style factory ----
  const handleStyle = (color: string): React.CSSProperties => ({
    position: 'absolute',
    width: 10, height: 10,
    borderRadius: '50%',
    background: '#fff',
    border: `2px solid ${color}`,
    cursor: 'default',
    pointerEvents: 'auto',
    zIndex: 3,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    boxShadow: '0 0 0 rgba(0,0,0,0)'
  })

  const edgeHandleStyle = (color: string, cursor: string): React.CSSProperties => ({
    position: 'absolute',
    background: color,
    opacity: 0.5,
    pointerEvents: 'auto',
    zIndex: 3,
    cursor,
    transition: 'opacity 0.15s ease, background 0.15s ease'
  })

  // Nothing selected — render nothing
  if (!videoBox && !textClipBox) return null

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', inset: 0,
        pointerEvents: 'none',
        zIndex: 10
      }}
    >
      {/* Video bounding box — interactive with crop + resize handles */}
      {videoBox && clip && (
        <div style={{
          position: 'absolute',
          left: `${videoBox.left}%`, top: `${videoBox.top}%`,
          width: `${videoBox.width}%`, height: `${videoBox.height}%`,
          border: '1.5px dashed rgba(83, 74, 183, 0.6)',
          boxSizing: 'border-box',
          pointerEvents: 'none'
        }}>
          {/* Edge crop handles */}
          <div onMouseDown={handleCropN} style={{ ...edgeHandleStyle('rgba(83,74,183,0.4)', 'ns-resize'), top: '-3px', left: '20%', right: '20%', height: 6, borderRadius: '3px' }} />
          <div onMouseDown={handleCropS} style={{ ...edgeHandleStyle('rgba(83,74,183,0.4)', 'ns-resize'), bottom: '-3px', left: '20%', right: '20%', height: 6, borderRadius: '3px' }} />
          <div onMouseDown={handleCropW} style={{ ...edgeHandleStyle('rgba(83,74,183,0.4)', 'ew-resize'), left: '-3px', top: '20%', bottom: '20%', width: 6, borderRadius: '3px' }} />
          <div onMouseDown={handleCropE} style={{ ...edgeHandleStyle('rgba(83,74,183,0.4)', 'ew-resize'), right: '-3px', top: '20%', bottom: '20%', width: 6, borderRadius: '3px' }} />

          {/* Corner resize handles */}
          <div onMouseDown={handleVideoResizeNW} style={{ ...handleStyle('#534AB7'), top: '-5px', left: '-5px', cursor: 'nwse-resize' }} title="Resize (hold Shift to lock ratio)" />
          <div onMouseDown={handleVideoResizeNE} style={{ ...handleStyle('#534AB7'), top: '-5px', right: '-5px', cursor: 'nesw-resize' }} title="Resize (hold Shift to lock ratio)" />
          <div onMouseDown={handleVideoResizeSW} style={{ ...handleStyle('#534AB7'), bottom: '-5px', left: '-5px', cursor: 'nesw-resize' }} title="Resize (hold Shift to lock ratio)" />
          <div onMouseDown={handleVideoResizeSE} style={{ ...handleStyle('#534AB7'), bottom: '-5px', right: '-5px', cursor: 'nwse-resize' }} title="Resize (hold Shift to lock ratio)" />

          {/* Corner crop handles (inside the box) */}
          <div onMouseDown={handleCropNW} style={{ ...handleStyle('#534AB7'), top: '2px', left: '2px', cursor: 'nwse-resize' }} title="Crop (hold Shift to lock)" />
          <div onMouseDown={handleCropNE} style={{ ...handleStyle('#534AB7'), top: '2px', right: '2px', cursor: 'nesw-resize' }} title="Crop (hold Shift to lock)" />
          <div onMouseDown={handleCropSW} style={{ ...handleStyle('#534AB7'), bottom: '2px', left: '2px', cursor: 'nesw-resize' }} title="Crop (hold Shift to lock)" />
          <div onMouseDown={handleCropSE} style={{ ...handleStyle('#534AB7'), bottom: '2px', right: '2px', cursor: 'nwse-resize' }} title="Crop (hold Shift to lock)" />
        </div>
      )}

      {/* Text clip bounding box — interactive (move, resize, rotate) */}
      {textClipBox && textClip && (() => {
        const rot = textClip.style?.rotation ?? 0
        return (
          <>
            {/* Rotation handle above top-center */}
            <div
              onMouseDown={handleRotateDown}
              style={{
                position: 'absolute',
                left: `${textClipBox.left + textClipBox.width / 2}%`,
                top: `${textClipBox.top}%`,
                width: 12, height: 12, borderRadius: '50%',
                background: '#7c5cfc', border: '2px solid #fff',
                cursor: 'grab',
                pointerEvents: 'auto',
                transform: 'translate(-50%, calc(-100% - 6px))',
                transformOrigin: 'center',
                zIndex: 2,
                transition: 'transform 0.15s ease, box-shadow 0.15s ease'
              }}
              title="Rotate"
            />
            {/* Bounding box (rotated + scaled) */}
            <div
              onMouseDown={handleMoveDown}
              style={{
                position: 'absolute',
                left: `${textClipBox.left}%`, top: `${textClipBox.top}%`,
                width: `${textClipBox.width}%`, height: `${textClipBox.height}%`,
                border: '1.5px solid rgba(124, 92, 252, 0.8)',
                boxSizing: 'border-box',
                cursor: 'move',
                pointerEvents: 'auto',
                transform: rot !== 0 ? `rotate(${rot}deg)` : undefined,
                transformOrigin: 'center',
                zIndex: 1
              }}
            >
              {/* Corner resize handles */}
              <div onMouseDown={handleResizeNW} style={{ ...handleStyle('#7c5cfc'), top: '-5px', left: '-5px', cursor: 'nwse-resize' }} title="Resize" />
              <div onMouseDown={handleResizeNE} style={{ ...handleStyle('#7c5cfc'), top: '-5px', right: '-5px', cursor: 'nesw-resize' }} title="Resize" />
              <div onMouseDown={handleResizeSW} style={{ ...handleStyle('#7c5cfc'), bottom: '-5px', left: '-5px', cursor: 'nesw-resize' }} title="Resize" />
              <div onMouseDown={handleResizeSE} style={{ ...handleStyle('#7c5cfc'), bottom: '-5px', right: '-5px', cursor: 'nwse-resize' }} title="Resize" />
            </div>
          </>
        )
      })()}

      {/* Dimension HUD overlay */}
      {hud && (
        <div
          style={{
            position: 'fixed',
            left: hud.x, top: hud.y,
            padding: '3px 8px',
            borderRadius: '4px',
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            pointerEvents: 'none',
            zIndex: 100,
            whiteSpace: 'nowrap'
          }}
        >
          {hud.text}
        </div>
      )}
    </div>
  )
}

export default TransformOverlay
