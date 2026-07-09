// ---------------------------------------------------------------------------
// Built-in Transition Definitions
// ---------------------------------------------------------------------------
//
// Registers all built-in transitions into a module-level TransitionRegistry.
// Import `builtinTransitionRegistry` to browse/search available transitions.

import { TransitionRegistry } from '../core/TransitionRegistry'
import type { TransitionDefinition } from '../types/Transition'
import { TRANSITION_DEFINITION_VERSION } from '../types/Transition'

/** Module-level registry instance. Import this for UI consumption. */
export const builtinTransitionRegistry = new TransitionRegistry('BuiltinTransitions')

const defs: TransitionDefinition[] = [
  {
    id: 'crossfade',
    displayName: 'Crossfade',
    category: 'dissolve',
    defaultDurationMs: 500,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
  {
    id: 'dip-to-black',
    displayName: 'Dip to Black',
    category: 'dissolve',
    defaultDurationMs: 500,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
  {
    id: 'slide-left',
    displayName: 'Slide Left',
    category: 'slide',
    defaultDurationMs: 400,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
  {
    id: 'slide-right',
    displayName: 'Slide Right',
    category: 'slide',
    defaultDurationMs: 400,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
  {
    id: 'slide-up',
    displayName: 'Slide Up',
    category: 'slide',
    defaultDurationMs: 400,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
  {
    id: 'slide-down',
    displayName: 'Slide Down',
    category: 'slide',
    defaultDurationMs: 400,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
  {
    id: 'wipe-left',
    displayName: 'Wipe Left',
    category: 'wipe',
    defaultDurationMs: 500,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
  {
    id: 'wipe-right',
    displayName: 'Wipe Right',
    category: 'wipe',
    defaultDurationMs: 500,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
  {
    id: 'zoom-in',
    displayName: 'Zoom In',
    category: 'zoom',
    defaultDurationMs: 400,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
  {
    id: 'zoom-out',
    displayName: 'Zoom Out',
    category: 'zoom',
    defaultDurationMs: 400,
    parameters: [],
    version: TRANSITION_DEFINITION_VERSION,
  },
]

for (const def of defs) {
  builtinTransitionRegistry.register(def)
}
