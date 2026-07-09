// ---------------------------------------------------------------------------
// Caption Preset Definitions
// ---------------------------------------------------------------------------
//
// Named caption STYLE presets (visual only — font, color, stroke, bg, etc).
// Animation is controlled SEPARATELY via the Animation tab in the Inspector.
// This separation lets users mix any style with any animation.
//
// SSOT: CaptionPresetPanel, Inspector, and Export all read from this map.

import type { CaptionStyle } from '../../../shared/types/caption'

export interface CaptionPreset {
  id: string
  displayName: string
  /** Partial style — merged over defaultStyle when applied. */
  style: Partial<CaptionStyle>
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: 'default',
    displayName: 'Default',
    style: {},
  },
  {
    id: 'bold-impact',
    displayName: 'Bold Impact',
    style: {
      fontFamily: 'Anton',
      fontSize: 64,
      fontWeight: 700,
      color: '#FFD700',
      strokeColor: '#000000',
      strokeWidth: 2,
    },
  },
  {
    id: 'karaoke-highlight',
    displayName: 'Karaoke Highlight',
    style: {
      fontFamily: 'Montserrat',
      fontSize: 52,
      fontWeight: 700,
      color: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 1,
      captionMode: 'karaoke',
      activeHighlightColor: '#FFD700',
      activeTextColor: '#000000',
      activeScale: 1.15,
    },
  },
  {
    id: 'typewriter-classic',
    displayName: 'Typewriter',
    style: {
      fontFamily: 'Courier New',
      fontSize: 40,
      fontWeight: 400,
      color: '#00FF00',
      strokeColor: '#003300',
      strokeWidth: 0,
      bgColor: '#000000',
      bgOpacity: 0.8,
      captionMode: 'full-phrase',
    },
  },
  {
    id: 'social-pop',
    displayName: 'Social Pop',
    style: {
      fontFamily: 'Poppins',
      fontSize: 56,
      fontWeight: 800,
      color: '#000000',
      strokeColor: '#FFFFFF',
      strokeWidth: 0,
      bgColor: '#FFFFFF',
      bgOpacity: 0.9,
      alignment: 'center',
    },
  },
  {
    id: 'cinematic',
    displayName: 'Cinematic',
    style: {
      fontFamily: 'Montserrat',
      fontSize: 44,
      fontWeight: 700,
      color: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 0.5,
      captionMode: 'full-phrase',
    },
  },
  {
    id: 'neon-glow',
    displayName: 'Neon Glow',
    style: {
      fontFamily: 'Bebas Neue',
      fontSize: 60,
      fontWeight: 700,
      color: '#FF00FF',
      strokeColor: '#FF00FF',
      strokeWidth: 3,
    },
  },
  {
    id: 'minimal-clean',
    displayName: 'Minimal Clean',
    style: {
      fontFamily: 'Inter',
      fontSize: 42,
      fontWeight: 600,
      color: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 0,
      bgColor: '#000000',
      bgOpacity: 0.4,
    },
  },
  {
    id: 'headline-dramatic',
    displayName: 'Headline Dramatic',
    style: {
      fontFamily: 'Oswald',
      fontSize: 58,
      fontWeight: 700,
      color: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 1.5,
      captionMode: 'full-phrase',
    },
  },
  {
    id: 'subtitle-soft',
    displayName: 'Subtitle Soft',
    style: {
      fontFamily: 'Inter',
      fontSize: 36,
      fontWeight: 500,
      color: '#E0E0E0',
      strokeColor: '#000000',
      strokeWidth: 0,
      bgColor: '#000000',
      bgOpacity: 0.5,
      position: 'bottom',
      y: 85,
    },
  },
  {
    id: 'emoji-style',
    displayName: 'Emoji Style',
    style: {
      fontFamily: 'Fredoka',
      fontSize: 54,
      fontWeight: 600,
      color: '#FFFFFF',
      strokeColor: '#333333',
      strokeWidth: 1,
      bgColor: '#FF6B6B',
      bgOpacity: 0.85,
    },
  },
  {
    id: 'retro-vhs',
    displayName: 'Retro VHS',
    style: {
      fontFamily: 'Courier New',
      fontSize: 44,
      fontWeight: 700,
      color: '#00FFFF',
      strokeColor: '#FF00FF',
      strokeWidth: 1,
      rotation: -1,
    },
  },
]

/** Lookup map for O(1) access by preset ID. */
export const CAPTION_PRESET_MAP: Record<string, CaptionPreset> = Object.fromEntries(
  CAPTION_PRESETS.map((p) => [p.id, p])
)
