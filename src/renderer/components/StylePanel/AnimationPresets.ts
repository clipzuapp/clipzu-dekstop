/**
 * AnimationPresets - Caption animation timing and keyframe definitions
 */

export interface AnimationPreset {
  name: string
  duration: number // ms
  easing: string
  description: string
}

export const ANIMATION_PRESETS: Record<string, AnimationPreset> = {
  none: {
    name: 'None',
    duration: 0,
    easing: 'linear',
    description: 'No animation'
  },
  pop: {
    name: 'Pop',
    duration: 120,
    easing: 'ease-out',
    description: 'Scale 0.8 to 1.0'
  },
  fade: {
    name: 'Fade',
    duration: 200,
    easing: 'linear',
    description: 'Opacity 0 to 1'
  },
  'slide-up': {
    name: 'Slide Up',
    duration: 150,
    easing: 'ease-out',
    description: 'TranslateY +12px to 0'
  },
  karaoke: {
    name: 'Karaoke',
    duration: 0, // Per-word timing
    easing: 'linear',
    description: 'Word-by-word highlight'
  },
  typewriter: {
    name: 'Typewriter',
    duration: 40, // Per character
    easing: 'steps(1)',
    description: 'Character-by-character reveal'
  }
}

/**
 * Calculate animation progress for a given preset
 */
export function getAnimationProgress(
  preset: string,
  elapsedMs: number,
  _totalDurationMs: number
): { scale: number; opacity: number; translateY: number; charIndex: number } {
  const anim = ANIMATION_PRESETS[preset]
  if (!anim || anim.duration === 0) {
    return { scale: 1, opacity: 1, translateY: 0, charIndex: -1 }
  }

  const progress = Math.min(1, elapsedMs / anim.duration)
  const easedProgress = applyEasing(progress, anim.easing)

  switch (preset) {
    case 'pop':
      return { scale: 0.8 + 0.2 * easedProgress, opacity: 1, translateY: 0, charIndex: -1 }
    case 'fade':
      return { scale: 1, opacity: easedProgress, translateY: 0, charIndex: -1 }
    case 'slide-up':
      return { scale: 1, opacity: 1, translateY: 12 * (1 - easedProgress), charIndex: -1 }
    case 'typewriter':
      return { scale: 1, opacity: 1, translateY: 0, charIndex: Math.floor(elapsedMs / 40) }
    case 'karaoke':
      return { scale: 1, opacity: 1, translateY: 0, charIndex: -1 }
    default:
      return { scale: 1, opacity: 1, translateY: 0, charIndex: -1 }
  }
}

function applyEasing(t: number, easing: string): number {
  switch (easing) {
    case 'ease-out':
      return 1 - Math.pow(1 - t, 3)
    case 'ease-in':
      return t * t * t
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    default:
      return t
  }
}

export default ANIMATION_PRESETS
