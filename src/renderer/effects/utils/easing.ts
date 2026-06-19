// ---------------------------------------------------------------------------
// Easing Engine — Pure math, no side effects
// ---------------------------------------------------------------------------

import { EASING_TYPES, type EasingType } from '../types/Keyframe'

/** Easing function signature: progress [0..1] → eased value [0..1]. */
export type EasingFunction = (t: number) => number

// ---------------------------------------------------------------------------
// Easing implementations
// ---------------------------------------------------------------------------

const linear: EasingFunction = (t) => t

const easeIn: EasingFunction = (t) => t * t * t

const easeOut: EasingFunction = (t) => 1 - Math.pow(1 - t, 3)

const easeInOut: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

const easeOutBack: EasingFunction = (t) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

const easeOutExpo: EasingFunction = (t) =>
  t === 1 ? 1 : 1 - Math.pow(2, -10 * t)

const easeOutElastic: EasingFunction = (t) => {
  if (t === 0 || t === 1) return t
  const c4 = (2 * Math.PI) / 3
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}

const easeOutBounce: EasingFunction = (t) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) {
    return n1 * t * t
  }
  if (t < 2 / d1) {
    const adjusted = t - 1.5 / d1
    return n1 * adjusted * adjusted + 0.75
  }
  if (t < 2.5 / d1) {
    const adjusted = t - 2.25 / d1
    return n1 * adjusted * adjusted + 0.9375
  }
  const adjusted = t - 2.625 / d1
  return n1 * adjusted * adjusted + 0.984375
}

// ---------------------------------------------------------------------------
// Lookup map (no switch dispatch)
// ---------------------------------------------------------------------------

/** All easing functions keyed by type. Single source of truth. */
export const EASING_FUNCTIONS: Readonly<Record<EasingType, EasingFunction>> = Object.freeze({
  linear,
  easeIn,
  easeOut,
  easeInOut,
  easeOutBack,
  easeOutExpo,
  easeOutElastic,
  easeOutBounce,
})

/**
 * Apply an easing function by type.
 * @param type — Easing curve identifier.
 * @param t — Linear progress in [0..1].
 * @returns Eased value. Input outside [0..1] is clamped.
 */
export function applyEasing(type: EasingType, t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return EASING_FUNCTIONS[type](clamped)
}

/** Re-export EASING_TYPES for convenience. */
export { EASING_TYPES }
