// ---------------------------------------------------------------------------
// Transition Registry — Production registry pattern
// ---------------------------------------------------------------------------

import type { TransitionDefinition } from '../types/Transition'
import { DuplicateRegistryError, RegistryNotFoundError } from '../errors/EffectErrors'

/**
 * Registry for transition definitions.
 *
 * Class-based — instantiate for isolated test environments.
 * No module-level singletons.
 */
export class TransitionRegistry {
  /** Internal storage. Insertion order preserved via Map. */
  private readonly transitions: Map<string, Readonly<TransitionDefinition>> = new Map()

  /** Human-readable name used in error messages. */
  private readonly registryName: string

  constructor(name = 'TransitionRegistry') {
    this.registryName = name
  }

  // ---------------------------------------------------------------------------
  // Mutating operations
  // ---------------------------------------------------------------------------

  /**
   * Register a new transition definition.
   * @throws DuplicateRegistryError if a transition with the same ID already exists.
   */
  register(definition: Readonly<TransitionDefinition>): void {
    if (this.transitions.has(definition.id)) {
      throw new DuplicateRegistryError(this.registryName, definition.id)
    }
    this.transitions.set(definition.id, Object.freeze({ ...definition }))
  }

  /**
   * Unregister a transition by ID.
   * @throws RegistryNotFoundError if the ID is not registered.
   */
  unregister(id: string): void {
    if (!this.transitions.has(id)) {
      throw new RegistryNotFoundError(this.registryName, id)
    }
    this.transitions.delete(id)
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /**
   * Retrieve a registered transition by ID.
   * @throws RegistryNotFoundError if the ID is not registered.
   */
  get(id: string): Readonly<TransitionDefinition> {
    const def = this.transitions.get(id)
    if (!def) {
      throw new RegistryNotFoundError(this.registryName, id)
    }
    return def
  }

  /** Check whether a transition with the given ID exists. */
  exists(id: string): boolean {
    return this.transitions.has(id)
  }

  /** Return all registered transitions in deterministic (insertion) order. */
  list(): ReadonlyArray<Readonly<TransitionDefinition>> {
    return Object.freeze([...this.transitions.values()])
  }

  /**
   * Search transitions by display name or category (case-insensitive substring).
   */
  search(query: string): ReadonlyArray<Readonly<TransitionDefinition>> {
    const lowerQuery = query.toLowerCase()
    const results: Readonly<TransitionDefinition>[] = []
    for (const def of this.transitions.values()) {
      if (
        def.displayName.toLowerCase().includes(lowerQuery) ||
        def.category.toLowerCase().includes(lowerQuery)
      ) {
        results.push(def)
      }
    }
    return Object.freeze(results)
  }

  /** Number of registered transitions. */
  get size(): number {
    return this.transitions.size
  }

  /** Remove all registered transitions. Primarily for test teardown. */
  clear(): void {
    this.transitions.clear()
  }
}
