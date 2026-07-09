/**
 * Phase 1d — Curated CapCut Built-in Effects Catalog
 *
 * Since CapCut's explore pages mostly show user-generated templates (not
 * built-in effects), this script provides a curated catalog of known
 * CapCut built-in effects, transitions, filters, and text animations.
 *
 * Sources: CapCut app documentation, community wikis, and the explore
 * sub-page names (which DO represent real effect categories).
 *
 * Usage:  npx tsx scripts/scrape-capcut/curated-catalog.ts
 * Output: data/raw/curated-catalog.json
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { slugify } from './_shared'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const OUT_DIR = join(ROOT, 'data', 'raw')
const OUT_FILE = join(OUT_DIR, 'curated-catalog.json')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CuratedEntry {
  name: string
  slug: string
  presetType: 'effect' | 'transition' | 'filter' | 'text-animation'
  category: string
  description: string
  tags: string[]
  /** Typical parameters for this effect type */
  typicalParams?: Record<string, { type: string; default: number | string; min?: number; max?: number }>
}

// ---------------------------------------------------------------------------
// Curated CapCut Built-in Effects
// ---------------------------------------------------------------------------

const EFFECTS: CuratedEntry[] = [
  // -- Blur --
  { name: 'Motion Blur', slug: 'motion-blur', presetType: 'effect', category: 'blur', description: 'Directional motion blur effect', tags: ['blur', 'motion'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 }, angle: { type: 'number', default: 0, min: 0, max: 360 } } },
  { name: 'Background Blur', slug: 'background-blur', presetType: 'effect', category: 'blur', description: 'Blur the background behind the subject', tags: ['blur', 'background', 'portrait'], typicalParams: { blurAmount: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Gaussian Blur', slug: 'gaussian-blur', presetType: 'effect', category: 'blur', description: 'Classic Gaussian blur', tags: ['blur'], typicalParams: { radius: { type: 'number', default: 10, min: 0, max: 100 } } },
  { name: 'Lens Blur', slug: 'lens-blur', presetType: 'effect', category: 'blur', description: 'Simulates camera lens bokeh blur', tags: ['blur', 'bokeh'], typicalParams: { radius: { type: 'number', default: 20, min: 0, max: 100 } } },

  // -- Glow / Light --
  { name: 'Glow', slug: 'glow', presetType: 'effect', category: 'glow', description: 'Soft glow effect around bright areas', tags: ['glow', 'light'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 }, radius: { type: 'number', default: 30, min: 0, max: 100 } } },
  { name: 'Edge Glow', slug: 'edge-glow', presetType: 'effect', category: 'glow', description: 'Glowing edges detection effect', tags: ['glow', 'edge'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 }, threshold: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Neon Glow', slug: 'neon-glow', presetType: 'effect', category: 'glow', description: 'Neon-style glowing effect', tags: ['glow', 'neon'], typicalParams: { intensity: { type: 'number', default: 70, min: 0, max: 100 }, color: { type: 'string', default: '#00ffff' } } },
  { name: 'Light Leak', slug: 'light-leak', presetType: 'effect', category: 'glow', description: 'Film light leak overlay', tags: ['light', 'film', 'overlay'] },
  { name: 'Aura', slug: 'aura', presetType: 'effect', category: 'glow', description: 'Colored aura around the subject', tags: ['glow', 'aura'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Sparkle', slug: 'sparkle', presetType: 'effect', category: 'glow', description: 'Sparkling light particles', tags: ['glow', 'sparkle', 'particles'] },

  // -- Camera --
  { name: '3D Zoom', slug: '3d-zoom', presetType: 'effect', category: 'camera', description: '3D parallax zoom effect', tags: ['camera', '3d', 'zoom'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Camera Shake', slug: 'camera-shake', presetType: 'effect', category: 'camera', description: 'Shaky camera simulation', tags: ['camera', 'shake'], typicalParams: { intensity: { type: 'number', default: 30, min: 0, max: 100 }, speed: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Zoom In', slug: 'zoom-in', presetType: 'effect', category: 'camera', description: 'Smooth zoom in effect', tags: ['camera', 'zoom'], typicalParams: { speed: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Zoom Out', slug: 'zoom-out', presetType: 'effect', category: 'camera', description: 'Smooth zoom out effect', tags: ['camera', 'zoom'], typicalParams: { speed: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Vertigo', slug: 'vertigo', presetType: 'effect', category: 'camera', description: 'Dolly zoom / vertigo effect', tags: ['camera', 'vertigo', 'dolly'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Pan', slug: 'pan', presetType: 'effect', category: 'camera', description: 'Smooth panning effect', tags: ['camera', 'pan'] },

  // -- Color --
  { name: 'Color Grading', slug: 'color-grading', presetType: 'effect', category: 'color', description: 'Cinematic color grading', tags: ['color', 'grading'], typicalParams: { temperature: { type: 'number', default: 0, min: -100, max: 100 }, tint: { type: 'number', default: 0, min: -100, max: 100 } } },
  { name: 'Teal and Orange', slug: 'teal-and-orange', presetType: 'effect', category: 'color', description: 'Classic teal and orange color grade', tags: ['color', 'cinematic'] },
  { name: 'Vintage Film', slug: 'vintage-film', presetType: 'effect', category: 'color', description: 'Vintage film color look', tags: ['color', 'vintage', 'film'] },
  { name: 'Fade', slug: 'fade', presetType: 'effect', category: 'color', description: 'Faded color effect', tags: ['color', 'fade'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Invert', slug: 'invert', presetType: 'effect', category: 'color', description: 'Color inversion', tags: ['color', 'invert'] },
  { name: 'Black and White', slug: 'black-and-white', presetType: 'effect', category: 'color', description: 'Monochrome conversion', tags: ['color', 'monochrome'], typicalParams: { contrast: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Sepia', slug: 'sepia', presetType: 'effect', category: 'color', description: 'Sepia tone effect', tags: ['color', 'sepia', 'vintage'] },

  // -- Distortion --
  { name: 'Glitch', slug: 'glitch', presetType: 'effect', category: 'distortion', description: 'Digital glitch distortion', tags: ['distortion', 'glitch', 'digital'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 }, speed: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Mirror', slug: 'mirror', presetType: 'effect', category: 'distortion', description: 'Mirror reflection effect', tags: ['distortion', 'mirror'] },
  { name: 'Kaleidoscope', slug: 'kaleidoscope', presetType: 'effect', category: 'distortion', description: 'Kaleidoscope pattern effect', tags: ['distortion', 'kaleidoscope'], typicalParams: { segments: { type: 'number', default: 6, min: 2, max: 12 } } },
  { name: 'Fisheye', slug: 'fisheye', presetType: 'effect', category: 'distortion', description: 'Fisheye lens distortion', tags: ['distortion', 'fisheye', 'lens'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Pixelate', slug: 'pixelate', presetType: 'effect', category: 'distortion', description: 'Pixelation effect', tags: ['distortion', 'pixelate'], typicalParams: { size: { type: 'number', default: 10, min: 1, max: 50 } } },
  { name: 'Wave Distort', slug: 'wave-distort', presetType: 'effect', category: 'distortion', description: 'Wave-like distortion', tags: ['distortion', 'wave'], typicalParams: { amplitude: { type: 'number', default: 20, min: 0, max: 100 }, frequency: { type: 'number', default: 5, min: 1, max: 20 } } },
  { name: 'Bulge', slug: 'bulge', presetType: 'effect', category: 'distortion', description: 'Bulge distortion effect', tags: ['distortion', 'bulge'], typicalParams: { intensity: { type: 'number', default: 50, min: -100, max: 100 } } },

  // -- Style --
  { name: 'Fire', slug: 'fire', presetType: 'effect', category: 'style', description: 'Fire overlay effect', tags: ['style', 'fire', 'overlay'] },
  { name: 'VFX Shake', slug: 'vfx-shake', presetType: 'effect', category: 'style', description: 'Impact shake effect', tags: ['style', 'vfx', 'shake'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Comic', slug: 'comic', presetType: 'effect', category: 'style', description: 'Comic book style effect', tags: ['style', 'comic'] },
  { name: 'Sketch', slug: 'sketch', presetType: 'effect', category: 'style', description: 'Pencil sketch effect', tags: ['style', 'sketch', 'drawing'] },
  { name: 'Pop Art', slug: 'pop-art', presetType: 'effect', category: 'style', description: 'Pop art style effect', tags: ['style', 'pop-art'] },
  { name: 'Oil Painting', slug: 'oil-painting', presetType: 'effect', category: 'style', description: 'Oil painting effect', tags: ['style', 'painting'], typicalParams: { brushSize: { type: 'number', default: 5, min: 1, max: 20 } } },
  { name: 'Mosaic', slug: 'mosaic', presetType: 'effect', category: 'style', description: 'Mosaic tile effect', tags: ['style', 'mosaic'], typicalParams: { tileSize: { type: 'number', default: 10, min: 2, max: 50 } } },
  { name: 'Chroma Key', slug: 'chroma-key', presetType: 'effect', category: 'utility', description: 'Green screen / chroma key', tags: ['utility', 'chroma', 'green-screen'], typicalParams: { similarity: { type: 'number', default: 50, min: 0, max: 100 }, smoothness: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Freeze Frame', slug: 'freeze-frame', presetType: 'effect', category: 'utility', description: 'Freeze the current frame', tags: ['utility', 'freeze'] },

  // -- Noise / Grain --
  { name: 'Film Grain', slug: 'film-grain', presetType: 'effect', category: 'noise', description: 'Analog film grain overlay', tags: ['noise', 'grain', 'film'], typicalParams: { intensity: { type: 'number', default: 30, min: 0, max: 100 } } },
  { name: 'Noise', slug: 'noise', presetType: 'effect', category: 'noise', description: 'Random noise overlay', tags: ['noise'], typicalParams: { intensity: { type: 'number', default: 30, min: 0, max: 100 } } },
  { name: 'Dust Overlay', slug: 'dust-overlay', presetType: 'effect', category: 'noise', description: 'Dust particles overlay', tags: ['noise', 'dust', 'overlay'], typicalParams: { intensity: { type: 'number', default: 30, min: 0, max: 100 } } },
  { name: 'Vignette', slug: 'vignette', presetType: 'effect', category: 'noise', description: 'Dark vignette around edges', tags: ['vignette'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 } } },

  // -- AI Effects --
  { name: 'AI Portrait', slug: 'ai-portrait', presetType: 'effect', category: 'ai', description: 'AI-powered portrait segmentation', tags: ['ai', 'portrait'] },
  { name: 'Face Blur', slug: 'face-blur', presetType: 'effect', category: 'ai', description: 'AI face detection and blur', tags: ['ai', 'face', 'blur'] },
  { name: 'Body Effects', slug: 'body-effects', presetType: 'effect', category: 'ai', description: 'AI body tracking effects', tags: ['ai', 'body'] },
  { name: 'Eye Blink Effect', slug: 'eye-blink-effect', presetType: 'effect', category: 'ai', description: 'Eye blink detection effect', tags: ['ai', 'eye', 'face'] },
  { name: 'Age Effect', slug: 'age-effect', presetType: 'effect', category: 'ai', description: 'AI age transformation', tags: ['ai', 'age', 'face'] },
  { name: 'Motion Trail', slug: 'motion-trail', presetType: 'effect', category: 'motion', description: 'Motion trail / ghost effect', tags: ['motion', 'trail'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 }, length: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Slow Motion', slug: 'slow-motion', presetType: 'effect', category: 'motion', description: 'Smooth slow motion', tags: ['motion', 'slowmo'], typicalParams: { speed: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'Speed Ramp', slug: 'speed-ramp', presetType: 'effect', category: 'motion', description: 'Variable speed ramping', tags: ['motion', 'speed'], typicalParams: { minSpeed: { type: 'number', default: 25, min: 0, max: 100 }, maxSpeed: { type: 'number', default: 200, min: 100, max: 400 } } },
]

// ---------------------------------------------------------------------------
// Curated CapCut Built-in Transitions
// ---------------------------------------------------------------------------

const TRANSITIONS: CuratedEntry[] = [
  // Dissolve
  { name: 'Dissolve', slug: 'dissolve', presetType: 'transition', category: 'dissolve', description: 'Classic crossfade dissolve', tags: ['dissolve', 'fade'], typicalParams: { duration: { type: 'number', default: 500, min: 100, max: 3000 } } },
  { name: 'Fade Black', slug: 'fade-black', presetType: 'transition', category: 'dissolve', description: 'Fade through black', tags: ['dissolve', 'fade', 'black'] },
  { name: 'Fade White', slug: 'fade-white', presetType: 'transition', category: 'dissolve', description: 'Fade through white', tags: ['dissolve', 'fade', 'white'] },
  { name: 'Mix', slug: 'mix', presetType: 'transition', category: 'dissolve', description: 'Blend mix transition', tags: ['dissolve', 'mix'] },

  // Slide
  { name: 'Slide Left', slug: 'slide-left', presetType: 'transition', category: 'slide', description: 'Slide transition to the left', tags: ['slide', 'left'] },
  { name: 'Slide Right', slug: 'slide-right', presetType: 'transition', category: 'slide', description: 'Slide transition to the right', tags: ['slide', 'right'] },
  { name: 'Slide Up', slug: 'slide-up', presetType: 'transition', category: 'slide', description: 'Slide transition upward', tags: ['slide', 'up'] },
  { name: 'Slide Down', slug: 'slide-down', presetType: 'transition', category: 'slide', description: 'Slide transition downward', tags: ['slide', 'down'] },
  { name: 'Push', slug: 'push', presetType: 'transition', category: 'slide', description: 'Push transition', tags: ['slide', 'push'] },
  { name: 'Pull', slug: 'pull', presetType: 'transition', category: 'slide', description: 'Pull transition', tags: ['slide', 'pull'] },

  // Wipe
  { name: 'Wipe Left', slug: 'wipe-left', presetType: 'transition', category: 'wipe', description: 'Linear wipe left to right', tags: ['wipe'] },
  { name: 'Wipe Right', slug: 'wipe-right', presetType: 'transition', category: 'wipe', description: 'Linear wipe right to left', tags: ['wipe'] },
  { name: 'Circular Wipe', slug: 'circular-wipe', presetType: 'transition', category: 'wipe', description: 'Circular iris wipe', tags: ['wipe', 'circular', 'iris'] },
  { name: 'Clock Wipe', slug: 'clock-wipe', presetType: 'transition', category: 'wipe', description: 'Clock-style wipe', tags: ['wipe', 'clock'] },

  // Zoom
  { name: 'Zoom In Transition', slug: 'zoom-in-transition', presetType: 'transition', category: 'zoom', description: 'Zoom in between clips', tags: ['zoom', 'in'] },
  { name: 'Zoom Out Transition', slug: 'zoom-out-transition', presetType: 'transition', category: 'zoom', description: 'Zoom out between clips', tags: ['zoom', 'out'] },
  { name: 'Zoom Blur', slug: 'zoom-blur-transition', presetType: 'transition', category: 'zoom', description: 'Zoom with motion blur', tags: ['zoom', 'blur'] },

  // Blur
  { name: 'Blur Transition', slug: 'blur-transition', presetType: 'transition', category: 'blur', description: 'Blur crossfade transition', tags: ['blur', 'transition'], typicalParams: { blurAmount: { type: 'number', default: 50, min: 0, max: 100 } } },

  // Light
  { name: 'Flash', slug: 'flash', presetType: 'transition', category: 'light', description: 'Flash of light transition', tags: ['light', 'flash'] },
  { name: 'Light Sweep', slug: 'light-sweep', presetType: 'transition', category: 'light', description: 'Light sweep across screen', tags: ['light', 'sweep'] },
  { name: 'Glitch Transition', slug: 'glitch-transition', presetType: 'transition', category: 'light', description: 'Digital glitch transition', tags: ['glitch', 'transition'] },
  { name: 'Spin', slug: 'spin', presetType: 'transition', category: 'light', description: 'Spinning rotation transition', tags: ['spin', 'rotation'] },
  { name: 'Whip Pan', slug: 'whip-pan', presetType: 'transition', category: 'slide', description: 'Fast whip pan transition', tags: ['slide', 'whip', 'pan'] },
  { name: 'Luma Fade', slug: 'luma-fade', presetType: 'transition', category: 'light', description: 'Luminance-based fade', tags: ['light', 'luma', 'fade'] },
]

// ---------------------------------------------------------------------------
// Curated CapCut Built-in Filters
// ---------------------------------------------------------------------------

const FILTERS: CuratedEntry[] = [
  { name: '4K Enhancement', slug: '4k-enhancement', presetType: 'filter', category: 'enhancement', description: 'Sharpening and clarity boost', tags: ['enhancement', '4k', 'sharp'], typicalParams: { intensity: { type: 'number', default: 50, min: 0, max: 100 } } },
  { name: 'HD Clear', slug: 'hd-clear', presetType: 'filter', category: 'enhancement', description: 'HD clarity filter', tags: ['enhancement', 'hd'] },
  { name: 'Warm', slug: 'warm', presetType: 'filter', category: 'color', description: 'Warm color temperature filter', tags: ['color', 'warm'], typicalParams: { temperature: { type: 'number', default: 30, min: -100, max: 100 } } },
  { name: 'Cool', slug: 'cool', presetType: 'filter', category: 'color', description: 'Cool color temperature filter', tags: ['color', 'cool'], typicalParams: { temperature: { type: 'number', default: -30, min: -100, max: 100 } } },
  { name: 'Vivid', slug: 'vivid', presetType: 'filter', category: 'color', description: 'Vibrant saturated look', tags: ['color', 'vivid'], typicalParams: { saturation: { type: 'number', default: 30, min: -100, max: 100 } } },
  { name: 'Natural', slug: 'natural', presetType: 'filter', category: 'color', description: 'Natural subtle enhancement', tags: ['color', 'natural'] },
  { name: 'Portrait', slug: 'portrait-filter', presetType: 'filter', category: 'color', description: 'Skin-tone optimized filter', tags: ['color', 'portrait'] },
  { name: 'Food', slug: 'food-filter', presetType: 'filter', category: 'color', description: 'Food photography filter', tags: ['color', 'food'] },
  { name: 'Landscape', slug: 'landscape-filter', presetType: 'filter', category: 'color', description: 'Landscape photography filter', tags: ['color', 'landscape'] },
  { name: 'Retro', slug: 'retro-filter', presetType: 'filter', category: 'style', description: 'Retro color look', tags: ['style', 'retro'] },
  { name: 'Cinematic', slug: 'cinematic-filter', presetType: 'filter', category: 'color', description: 'Cinematic color grading filter', tags: ['color', 'cinematic'] },
  { name: 'Moody', slug: 'moody', presetType: 'filter', category: 'color', description: 'Dark moody tone', tags: ['color', 'moody', 'dark'] },
  { name: 'Bright', slug: 'bright', presetType: 'filter', category: 'color', description: 'Bright and airy look', tags: ['color', 'bright'] },
  { name: 'Lo-Fi', slug: 'lo-fi', presetType: 'filter', category: 'style', description: 'Lo-fi aesthetic filter', tags: ['style', 'lofi', 'vintage'] },
  { name: 'Dust', slug: 'dust-filter', presetType: 'filter', category: 'style', description: 'Dusty film overlay filter', tags: ['style', 'dust', 'film'] },
]

// ---------------------------------------------------------------------------
// Curated CapCut Text Animations
// ---------------------------------------------------------------------------

const TEXT_ANIMATIONS: CuratedEntry[] = [
  // Entrance
  { name: 'Fade In', slug: 'fade-in', presetType: 'text-animation', category: 'entrance', description: 'Text fades in', tags: ['entrance', 'fade'], typicalParams: { duration: { type: 'number', default: 300, min: 100, max: 2000 } } },
  { name: 'Slide In Left', slug: 'slide-in-left', presetType: 'text-animation', category: 'entrance', description: 'Text slides in from left', tags: ['entrance', 'slide'] },
  { name: 'Slide In Right', slug: 'slide-in-right', presetType: 'text-animation', category: 'entrance', description: 'Text slides in from right', tags: ['entrance', 'slide'] },
  { name: 'Slide In Bottom', slug: 'slide-in-bottom', presetType: 'text-animation', category: 'entrance', description: 'Text slides in from bottom', tags: ['entrance', 'slide'] },
  { name: 'Slide In Top', slug: 'slide-in-top', presetType: 'text-animation', category: 'entrance', description: 'Text slides in from top', tags: ['entrance', 'slide'] },
  { name: 'Scale In', slug: 'scale-in', presetType: 'text-animation', category: 'entrance', description: 'Text scales in', tags: ['entrance', 'scale'] },
  { name: 'Bounce In', slug: 'bounce-in', presetType: 'text-animation', category: 'entrance', description: 'Text bounces in', tags: ['entrance', 'bounce'] },
  { name: 'Typewriter', slug: 'typewriter', presetType: 'text-animation', category: 'text', description: 'Character-by-character reveal', tags: ['text', 'typewriter'] },
  { name: 'Karaoke', slug: 'karaoke', presetType: 'text-animation', category: 'text', description: 'Word-by-word highlight', tags: ['text', 'karaoke'] },
  { name: 'Word Pop', slug: 'word-pop', presetType: 'text-animation', category: 'text', description: 'Words pop in one by one', tags: ['text', 'pop'] },

  // Emphasis
  { name: 'Pulse', slug: 'pulse', presetType: 'text-animation', category: 'emphasis', description: 'Pulsing scale animation', tags: ['emphasis', 'pulse'] },
  { name: 'Shake', slug: 'shake-text', presetType: 'text-animation', category: 'emphasis', description: 'Shaking text animation', tags: ['emphasis', 'shake'] },
  { name: 'Wobble', slug: 'wobble', presetType: 'text-animation', category: 'emphasis', description: 'Wobbling text animation', tags: ['emphasis', 'wobble'] },
  { name: 'Glow Text', slug: 'glow-text', presetType: 'text-animation', category: 'emphasis', description: 'Glowing text animation', tags: ['emphasis', 'glow'] },

  // Exit
  { name: 'Fade Out', slug: 'fade-out', presetType: 'text-animation', category: 'exit', description: 'Text fades out', tags: ['exit', 'fade'] },
  { name: 'Slide Out Left', slug: 'slide-out-left', presetType: 'text-animation', category: 'exit', description: 'Text slides out to left', tags: ['exit', 'slide'] },
  { name: 'Slide Out Right', slug: 'slide-out-right', presetType: 'text-animation', category: 'exit', description: 'Text slides out to right', tags: ['exit', 'slide'] },
  { name: 'Scale Out', slug: 'scale-out', presetType: 'text-animation', category: 'exit', description: 'Text scales out', tags: ['exit', 'scale'] },

  // Motion
  { name: '3D Text Rotate', slug: '3d-text-rotate', presetType: 'text-animation', category: 'motion', description: '3D rotation text animation', tags: ['motion', '3d', 'rotate'] },
  { name: 'Float', slug: 'float-text', presetType: 'text-animation', category: 'motion', description: 'Floating text animation', tags: ['motion', 'float'] },
  { name: 'Spin Text', slug: 'spin-text', presetType: 'text-animation', category: 'motion', description: 'Spinning text animation', tags: ['motion', 'spin'] },
  { name: 'Glitch Text', slug: 'glitch-text', presetType: 'text-animation', category: 'motion', description: 'Glitchy text animation', tags: ['motion', 'glitch'] },
]

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('[curated-catalog] Building curated CapCut catalog...\n')

  const allEntries = [...EFFECTS, ...TRANSITIONS, ...FILTERS, ...TEXT_ANIMATIONS]

  // Verify slugs are unique
  const slugs = new Set<string>()
  for (const entry of allEntries) {
    if (slugs.has(entry.slug)) {
      console.warn(`  Duplicate slug: ${entry.slug}`)
    }
    slugs.add(entry.slug)
  }

  const catalog = {
    generatedAt: new Date().toISOString(),
    source: 'curated',
    totalEntries: allEntries.length,
    summary: {
      effects: EFFECTS.length,
      transitions: TRANSITIONS.length,
      filters: FILTERS.length,
      textAnimations: TEXT_ANIMATIONS.length
    },
    entries: allEntries
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(catalog, null, 2))

  console.log(`  Effects:         ${EFFECTS.length}`)
  console.log(`  Transitions:     ${TRANSITIONS.length}`)
  console.log(`  Filters:         ${FILTERS.length}`)
  console.log(`  Text Animations: ${TEXT_ANIMATIONS.length}`)
  console.log(`  Total:           ${allEntries.length}`)
  console.log(`\n[curated-catalog] Done! -> ${OUT_FILE}`)
}

main()
