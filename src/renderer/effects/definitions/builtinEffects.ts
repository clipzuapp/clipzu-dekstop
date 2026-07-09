// ---------------------------------------------------------------------------
// Built-in Effect Definitions
// ---------------------------------------------------------------------------
//
// Registers all built-in effects into a module-level EffectRegistry.
// Import `builtinEffectRegistry` to browse/search available effects.

import { EffectRegistry } from '../core/EffectRegistry'
import type { EffectDefinition } from '../types/Effect'
import { EFFECT_DEFINITION_VERSION } from '../types/Effect'

/** Module-level registry instance. Import this for UI consumption. */
export const builtinEffectRegistry = new EffectRegistry('BuiltinEffects')

const defs: EffectDefinition[] = [
  {
    id: 'blur',
    category: 'blur',
    displayName: 'Blur',
    parameters: [
      { name: 'amount', displayName: 'Amount', descriptor: { valueType: 'number', default: 10, min: 0, max: 50, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
  {
    id: 'brightness',
    category: 'color',
    displayName: 'Brightness',
    parameters: [
      { name: 'level', displayName: 'Level', descriptor: { valueType: 'number', default: 0, min: -100, max: 100, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
  {
    id: 'contrast',
    category: 'color',
    displayName: 'Contrast',
    parameters: [
      { name: 'level', displayName: 'Level', descriptor: { valueType: 'number', default: 0, min: -100, max: 100, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
  {
    id: 'saturation',
    category: 'color',
    displayName: 'Saturation',
    parameters: [
      { name: 'level', displayName: 'Level', descriptor: { valueType: 'number', default: 0, min: -100, max: 100, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
  {
    id: 'exposure',
    category: 'color',
    displayName: 'Exposure',
    parameters: [
      { name: 'level', displayName: 'Level', descriptor: { valueType: 'number', default: 0, min: -100, max: 100, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
  {
    id: 'hue-rotate',
    category: 'color',
    displayName: 'Hue Rotate',
    parameters: [
      { name: 'angle', displayName: 'Angle', descriptor: { valueType: 'number', default: 0, min: 0, max: 360, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
  {
    id: 'sepia',
    category: 'style',
    displayName: 'Sepia',
    parameters: [
      { name: 'amount', displayName: 'Amount', descriptor: { valueType: 'number', default: 100, min: 0, max: 100, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
  {
    id: 'grayscale',
    category: 'style',
    displayName: 'Grayscale',
    parameters: [
      { name: 'amount', displayName: 'Amount', descriptor: { valueType: 'number', default: 100, min: 0, max: 100, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
  {
    id: 'invert',
    category: 'style',
    displayName: 'Invert',
    parameters: [
      { name: 'amount', displayName: 'Amount', descriptor: { valueType: 'number', default: 100, min: 0, max: 100, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
  {
    id: 'sharpen',
    category: 'utility',
    displayName: 'Sharpen',
    parameters: [
      { name: 'amount', displayName: 'Amount', descriptor: { valueType: 'number', default: 50, min: 0, max: 100, step: 1 } },
    ],
    version: EFFECT_DEFINITION_VERSION,
  },
]

for (const def of defs) {
  builtinEffectRegistry.register(def)
}
