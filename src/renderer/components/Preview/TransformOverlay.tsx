import { useRef, useCallback } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { useProject } from '../../store/useProject'
import { getTextClipPercentBounds } from '../../utils/geometry'

// ---------------------------------------------------------------------------
// TransformOverlay — transparent interactive layer on top of Preview canvas.
//
// Single owner for ALL transform bounding boxes (DOM-based).
// Canvas handles content rendering only.
// Priority: TextClip > Video Clip
//
// Supports: body drag (move), corner resize (scale), rotation handle (rotate)
// ---------------------------------------------------------------------------

type DragOp = 'move' | 'resize-ne' | 'resize-nw' | 'resize-se' | 'resize-sw' | 'rotate'

export function TransformOverlay(): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedClipId = useTimeline((s) => s.selectedClipId)
  const selectedTextClipId = useTimeline((s) => s.selectedTextClipId)
  const clips = useTimeline((s) => s.clips)
  const textClips = useTimeline((s) => s.textClips)
  const updateTextClipLive = useTimeline((s) => s.updateTextClipLive)
  const beginDragCapture = useTimeline((s) => s.beginDragCapture)
  const commitDrag = useTimeline((s) => s.commitDrag)
  const cancelDrag = useTimeline((s) => s.cancelDrag)

  const pw = useProject((s) => s.resolution.width)
  const ph = useProject((s) => s.resolution.height)

  // Display-size ref (set on drag start for movementX/Y → % conversion)
  const displaySizeRef = useRef({ w: 1, h: 1 })
  const dragOffsetRef = useRef({ dx: 0, dy: 0 })

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

  // ---- Video bounding box (visual indicator only — canvas gizmo handles drag) ----
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

  // ---- Text clip bounding box (interactive — draggable, resizable, rotatable) ----
  let textClipBox: { left: number; top: number; width: number; height: number } | null = null
  if (textClip?.style) {
    const s = textClip.style
    const bounds = getTextClipPercentBounds(
      textClip.text, s.fontFamily, s.fontSize, s.fontWeight, s.scale ?? 1, s.x, s.y, pw, ph
    )
    textClipBox = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
  }

  // ---- Drag-start helpers ----

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
    // Box center in percentage
    const boxCenterX = startX
    const boxCenterY = startY

    // Declare onMove before branches so cleanup can reference it
    let onMove: ((ev: MouseEvent) => void) | undefined

    const cleanup = (): void => {
      if (onMove) window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
    }
    const onUp = (): void => {
      commitDrag()
      cleanup()
    }
    const onBlur = (): void => {
      commitDrag()
      cleanup()
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        cancelDrag()
        cleanup()
      }
    }

    if (op === 'move') {
      dragOffsetRef.current = { dx: 0, dy: 0 }
      onMove = (ev: MouseEvent): void => {
        const dw = displaySizeRef.current.w
        const dh = displaySizeRef.current.h
        dragOffsetRef.current.dx += ev.movementX
        dragOffsetRef.current.dy += ev.movementY
        const newX = Math.max(0, Math.min(100, startX + (dragOffsetRef.current.dx / dw) * 100))
        const newY = Math.max(0, Math.min(100, startY + (dragOffsetRef.current.dy / dh) * 100))
        updateTextClipLive(selectedTextClipId, { style: { ...style, x: newX, y: newY } })
      }
      window.addEventListener('mousemove', onMove!)
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
      onMove = (ev: MouseEvent): void => {
        const angle = startAngle(ev)
        let rot = startRotation + (angle - baseAngle)
        // Normalize to [-180, 180]
        while (rot > 180) rot -= 360
        while (rot < -180) rot += 360
        updateTextClipLive(selectedTextClipId, { style: { ...style, rotation: rot } })
      }
      window.addEventListener('mousemove', onMove!)
    } else {
      // Corner resize — compute scale from distance to opposite corner
      const pairMap: Record<string, 'sw' | 'se' | 'ne' | 'nw'> = {
        'resize-ne': 'sw', 'resize-nw': 'se', 'resize-se': 'nw', 'resize-sw': 'ne'
      }
      const oppositeCorner = pairMap[op]
      // Compute fixed opposite corner position in %
      let fixedX = boxCenterX
      let fixedY = boxCenterY
      if (!textClipBox) return
      // Opposite corner = center + sign * half-extent
      if (oppositeCorner.includes('e')) fixedX = boxCenterX + textClipBox.width / 2
      else if (oppositeCorner.includes('w')) fixedX = boxCenterX - textClipBox.width / 2
      if (oppositeCorner.includes('s')) fixedY = boxCenterY + textClipBox.height / 2
      else if (oppositeCorner.includes('n')) fixedY = boxCenterY - textClipBox.height / 2

      onMove = (ev: MouseEvent): void => {
        const el = containerRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const dw = r.width || 1
        const dh = r.height || 1
        const mx = ((ev.clientX - r.left) / dw) * 100
        const my = ((ev.clientY - r.top) / dh) * 100
        // Distance from opposite corner to current mouse
        const dx = Math.abs(mx - fixedX)
        const dy = Math.abs(my - fixedY)
        // New uniform scale = average of width/height scale changes
        const origW = textClipBox!.width
        const origH = textClipBox!.height
        const sX = origW > 0 ? dx / origW : 1
        const sY = origH > 0 ? dy / origH : 1
        const newScale = Math.max(0.1, Math.min(5, (sX + sY) / 2))
        updateTextClipLive(selectedTextClipId, { style: { ...style, scale: newScale } })
      }
      window.addEventListener('mousemove', onMove!)
    }

    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
  }, [textClip, textClipBox, selectedTextClipId, updateTextClipLive, beginDragCapture, commitDrag, cancelDrag, captureDisplaySize])

  // Handlers exposed to JSX
  const handleMoveDown = useCallback((e: React.MouseEvent) => startTextClipDrag('move', e), [startTextClipDrag])
  const handleResizeNW = useCallback((e: React.MouseEvent) => startTextClipDrag('resize-nw', e), [startTextClipDrag])
  const handleResizeNE = useCallback((e: React.MouseEvent) => startTextClipDrag('resize-ne', e), [startTextClipDrag])
  const handleResizeSW = useCallback((e: React.MouseEvent) => startTextClipDrag('resize-sw', e), [startTextClipDrag])
  const handleResizeSE = useCallback((e: React.MouseEvent) => startTextClipDrag('resize-se', e), [startTextClipDrag])
  const handleRotateDown = useCallback((e: React.MouseEvent) => startTextClipDrag('rotate', e), [startTextClipDrag])

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
      {/* Video bounding box — visual indicator only */}
      {videoBox && (
        <div style={{
          position: 'absolute',
          left: `${videoBox.left}%`, top: `${videoBox.top}%`,
          width: `${videoBox.width}%`, height: `${videoBox.height}%`,
          border: '1.5px dashed rgba(83, 74, 183, 0.6)',
          boxSizing: 'border-box',
          pointerEvents: 'none'
        }}>
          {[
            { t: '-4px', l: '-4px' }, { t: '-4px', r: '-4px' },
            { b: '-4px', l: '-4px' }, { b: '-4px', r: '-4px' }
          ].map((pos, i) => (
            <div key={i} style={{
              position: 'absolute', ...pos,
              width: 8, height: 8, borderRadius: '50%',
              background: '#fff', border: '1.5px solid #534AB7'
            }} />
          ))}
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
                zIndex: 2
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
              <div onMouseDown={handleResizeNW} style={{ position: 'absolute', top: '-4px', left: '-4px', width: 8, height: 8, borderRadius: '50%', background: '#fff', border: '1.5px solid #7c5cfc', cursor: 'nwse-resize', zIndex: 3 }} />
              <div onMouseDown={handleResizeNE} style={{ position: 'absolute', top: '-4px', right: '-4px', width: 8, height: 8, borderRadius: '50%', background: '#fff', border: '1.5px solid #7c5cfc', cursor: 'nesw-resize', zIndex: 3 }} />
              <div onMouseDown={handleResizeSW} style={{ position: 'absolute', bottom: '-4px', left: '-4px', width: 8, height: 8, borderRadius: '50%', background: '#fff', border: '1.5px solid #7c5cfc', cursor: 'nesw-resize', zIndex: 3 }} />
              <div onMouseDown={handleResizeSE} style={{ position: 'absolute', bottom: '-4px', right: '-4px', width: 8, height: 8, borderRadius: '50%', background: '#fff', border: '1.5px solid #7c5cfc', cursor: 'nwse-resize', zIndex: 3 }} />
            </div>
          </>
        )
      })()}
    </div>
  )
}

export default TransformOverlay
