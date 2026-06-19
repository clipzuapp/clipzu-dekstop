// ---------------------------------------------------------------------------
// Keyframe Domain Types
// ---------------------------------------------------------------------------

/** All supported easing curves. Single source of truth. */
export const EASING_TYPES = [
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeOutBack',
  'easeOutExpo',
  'easeOutElastic',
  'easeOutBounce',
] as const

/** Easing function identifier. */
export type EasingType = (typeof EASING_TYPES)[number]

/** A single keyframe on a property track. */
export interface Keyframe {
  /** Time offset in milliseconds relative to the owning modifier's start. */
  time: number

  /** Interpolated value at this keyframe. */
  value: number | string | boolean

  /** Easing curve applied from this keyframe to the next. */
  easing: EasingType
}

/** A sequence of keyframes targeting a single animatable property. */
export interface KeyframeTrack {
  /** Property path being animated (e.g. "opacity", "scale", "positionX"). */
  property: string

  /** Ordered keyframes. Must contain at least one frame. */
  frames: Keyframe[]
}

/** Properties available for keyframe animation — Version 1. */
export const KEYFRAME_PROPERTIES_V1 = [
  'opacity',
  'scale',
  'rotation',
  'positionX',
  'positionY',
] as const

export type KeyframePropertyV1 = (typeof KEYFRAME_PROPERTIES_V1)[number]

/** All animatable properties across all versions. */
export const KEYFRAME_PROPERTIES = [
  ...KEYFRAME_PROPERTIES_V1,
  // Version 2 (reserved)
  // 'blur', 'brightness', 'contrast', 'exposure', 'saturation',
  // Version 3 (reserved)
  // 'glow', 'shadow', 'outline', 'rgbSplit', 'cameraZoom',
] as const

export type KeyframeProperty = (typeof KEYFRAME_PROPERTIES)[number]
