import { useRef, useEffect } from 'react'
import { usePreviewView } from '../../store/usePreviewView'
import { useProject } from '../../store/useProject'
import { useTimeline } from '../../store/useTimeline'

/**
 * GuideOverlay — Canvas overlay rendering safe areas, grids, and snap guides.
 * Sits above TransformOverlay in the z-stack. Reads usePreviewView.guides.
 * Renders nothing when all guides are off (zero cost).
 */
export function GuideOverlay(): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  const guides = usePreviewView((s) => s.guides)
  const pw = useProject((s) => s.resolution.width)
  const ph = useProject((s) => s.resolution.height)

  // Snap guide state: track focused text clip position for center-snap
  const focusedId = useTimeline((s) => s.focusedId)
  const textClips = useTimeline((s) => s.textClips)

  const hasGuides = guides.titleSafe || guides.actionSafe || guides.grid !== 'none'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const render = (): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Resolve focused text clip for snap guides (always check when a text clip is focused)
      let snapX: number | null = null
      let snapY: number | null = null
      if (focusedId) {
        const tc = textClips.find((t) => t.id === focusedId)
        if (tc?.style) {
          const xPct = tc.style.x
          const yPct = tc.style.y
          const SNAP_THRESHOLD = 2 // % from center
          if (Math.abs(xPct - 50) < SNAP_THRESHOLD) snapX = 50
          if (Math.abs(yPct - 50) < SNAP_THRESHOLD) snapY = 50
        }
      }

      // ---- Title Safe (5% inset, dashed) ----
      if (guides.titleSafe) {
        const inset = 0.05
        const x = canvas.width * inset
        const y = canvas.height * inset
        const w = canvas.width * (1 - 2 * inset)
        const h = canvas.height * (1 - 2 * inset)

        ctx.save()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
        ctx.lineWidth = 1
        ctx.setLineDash([8, 4])
        ctx.strokeRect(x, y, w, h)
        ctx.setLineDash([])
        ctx.restore()
      }

      // ---- Action Safe (3.5% inset, dotted) ----
      if (guides.actionSafe) {
        const inset = 0.035
        const x = canvas.width * inset
        const y = canvas.height * inset
        const w = canvas.width * (1 - 2 * inset)
        const h = canvas.height * (1 - 2 * inset)

        ctx.save()
        ctx.strokeStyle = 'rgba(255, 200, 50, 0.35)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.strokeRect(x, y, w, h)
        ctx.setLineDash([])
        ctx.restore()
      }

      // ---- Grid: Thirds ----
      if (guides.grid === 'thirds') {
        ctx.save()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
        ctx.lineWidth = 0.5

        // Vertical lines at 1/3 and 2/3
        const x1 = canvas.width / 3
        const x2 = (canvas.width * 2) / 3
        ctx.beginPath()
        ctx.moveTo(x1, 0)
        ctx.lineTo(x1, canvas.height)
        ctx.moveTo(x2, 0)
        ctx.lineTo(x2, canvas.height)

        // Horizontal lines at 1/3 and 2/3
        const y1 = canvas.height / 3
        const y2 = (canvas.height * 2) / 3
        ctx.moveTo(0, y1)
        ctx.lineTo(canvas.width, y1)
        ctx.moveTo(0, y2)
        ctx.lineTo(canvas.width, y2)

        ctx.stroke()
        ctx.restore()
      }

      // ---- Grid: Center cross ----
      if (guides.grid === 'center') {
        ctx.save()
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
        ctx.lineWidth = 0.5

        const cx = canvas.width / 2
        const cy = canvas.height / 2

        ctx.beginPath()
        ctx.moveTo(cx, 0)
        ctx.lineTo(cx, canvas.height)
        ctx.moveTo(0, cy)
        ctx.lineTo(canvas.width, cy)
        ctx.stroke()
        ctx.restore()
      }

      // ---- Snap guides (bright magenta lines at center) ----
      if (snapX !== null) {
        ctx.save()
        ctx.strokeStyle = 'rgba(255, 50, 255, 0.8)'
        ctx.lineWidth = 1
        ctx.setLineDash([])
        const x = (snapX / 100) * canvas.width
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, canvas.height)
        ctx.stroke()
        ctx.restore()
      }
      if (snapY !== null) {
        ctx.save()
        ctx.strokeStyle = 'rgba(255, 50, 255, 0.8)'
        ctx.lineWidth = 1
        ctx.setLineDash([])
        const y = (snapY / 100) * canvas.height
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(canvas.width, y)
        ctx.stroke()
        ctx.restore()
      }

      animRef.current = requestAnimationFrame(render)
    }

    animRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animRef.current)
  }, [guides, pw, ph, focusedId, textClips])

  // Nothing to draw — render null (zero DOM cost)
  if (!hasGuides && !focusedId) return null

  return (
    <canvas
      ref={canvasRef}
      width={pw}
      height={ph}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 15
      }}
    />
  )
}

export default GuideOverlay
