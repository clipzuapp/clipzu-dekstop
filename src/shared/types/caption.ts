/**
 * CaptionStyle — single source of truth for all caption visual properties.
 *
 * This type is used by:
 *   - renderer/store/useCaption.ts       (editor state)
 *   - renderer/store/useTimeline.ts      (per-clip style on TextClip)
 *   - renderer/components/Preview        (canvas draw functions)
 *   - renderer/components/Inspector      (style binding + UI)
 *   - renderer/components/ExportDialog   (projection to export pipeline)
 *   - shared/utils/srt.ts                (ASS/SRT export)
 *   - main/ipc/project.handler.ts        (project file serialization)
 *
 * RULES:
 *   - All fields shared by renderer, exporter, and serializer live here.
 *   - No nested objects. Flat structure is load-bearing — the entire write
 *     path uses { ...style, ...partial } shallow merge.
 *   - Optional fields must default gracefully with `?? fallback` at every
 *     read site. No migration required for old .ecp files.
 *   - When adding a field: add it here, then update defaultStyle in
 *     useCaption.ts, the ExportDialog projection blocks, and any renderer
 *     that needs to read it. The compiler will surface omissions.
 */
export interface CaptionStyle {
  // ---------------------------------------------------------------------------
  // Typography
  // ---------------------------------------------------------------------------
  fontFamily: string
  fontSize: number
  fontWeight: number

  // ---------------------------------------------------------------------------
  // Colors
  // ---------------------------------------------------------------------------
  color: string
  strokeColor: string
  strokeWidth: number
  bgColor: string
  bgOpacity: number

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  alignment: 'left' | 'center' | 'right'
  /** Used by ASS margin computation. Not read by the canvas renderer (x/y drive canvas). */
  position: 'top' | 'center' | 'bottom'
  x: number
  y: number
  rotation: number
  /** Uniform caption scale multiplier (1.0 = native size). */
  scale: number

  // ---------------------------------------------------------------------------
  // Behavior
  // ---------------------------------------------------------------------------
  animation: 'none' | 'pop' | 'fade' | 'slide-up' | 'karaoke' | 'typewriter'
  captionMode: 'full-phrase' | 'word-reveal' | 'karaoke' | 'single-word'
  /** Smooth fade-in duration for word-reveal mode (ms). 0 = instant. */
  revealFadeMs?: number

  // ---------------------------------------------------------------------------
  // Active State — visual overrides applied while an element is active.
  //
  // "Active element" is the currently spoken/highlighted unit. Today that is a
  // word (karaoke, single-word modes). The naming is intentionally generic so
  // future modes (phrase, line, speaker, AI emphasis) can reuse the same fields
  // without a data model change.
  //
  // All three fields are optional. When undefined the renderer falls back to
  // the existing hardcoded default, preserving backward compatibility.
  // ---------------------------------------------------------------------------

  /**
   * Background highlight color drawn behind the active element.
   * Karaoke mode: filled rectangle behind the active word.
   * Falls back to '#FFD700' (gold) when undefined.
   */
  activeHighlightColor?: string

  /**
   * Text color of the active element, drawn on top of the highlight.
   * Falls back to '#000000' (black) when undefined.
   */
  activeTextColor?: string

  /**
   * Scale multiplier applied to the active element (1.0 = no change).
   * Applied as an instant snap — no animation curve.
   * Falls back to 1.0 when undefined.
   */
  activeScale?: number
}
