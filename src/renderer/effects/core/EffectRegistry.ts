// ---------------------------------------------------------------------------
// Effect Registry — Production registry pattern
// ---------------------------------------------------------------------------

import type { EffectDefinition } from '../types/Effect'
import { DuplicateRegistryError, RegistryNotFoundError } from '../errors/EffectErrors'

/**
 * Registry for effect definitions.
 *
 * Class-based — instantiate for isolated test environments.
 * No module-level singletons.
 */
export class EffectRegistry {
  /** Internal storage. Insertion order preserved via Map. */
  private readonly effects: Map<string, Readonly<EffectDefinition>> = new Map()

  /** Human-readable name used in error messages. */
  private readonly registryName: string

  constructor(name = 'EffectRegistry') {
    this.registryName = name
  }

  // ---------------------------------------------------------------------------
  // Mutating operations
  // ---------------------------------------------------------------------------

  /**
   * Register a new effect definition.
   * @throws DuplicateRegistryError if an effect with the same ID already exists.
   */
  register(definition: Readonly<EffectDefinition>): void {
    if (this.effects.has(definition.id)) {
      throw new DuplicateRegistryError(this.registryName, definition.id)
    }
    // Store a frozen copy — public access must be immutable
    this.effects.set(definition.id, Object.freeze({ ...definition }))
  }

  /**
   * Unregister an effect by ID.
   * @throws RegistryNotFoundError if the ID is not registered.
   */
  unregister(id: string): void {
    if (!this.effects.has(id)) {
      throw new RegistryNotFoundError(this.registryName, id)
    }
    this.effects.delete(id)
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /**
   * Retrieve a registered effect by ID.
   * @throws RegistryNotFoundError if the ID is not registered.
   */
  get(id: string): Readonly<EffectDefinition> {
    const def = this.effects.get(id)
    if (!def) {
      throw new RegistryNotFoundError(this.registryName, id)
    }
    return def
  }

  /** Check whether an effect with the given ID exists. */
  exists(id: string): boolean {
    return this.effects.has(id)
  }

  /** Return all registered effects in deterministic (insertion) order. */
  list(): ReadonlyArray<Readonly<EffectDefinition>> {
    return Object.freeze([...this.effects.values()])
  }

  /**
   * Search effects by display name or category (case-insensitive substring).
   * Returns matching definitions in insertion order.
   */
  search(query: string): ReadonlyArray<Readonly<EffectDefinition>> {
    const lowerQuery = query.toLowerCase()
    const results: Readonly<EffectDefinition>[] = []
    for (const def of this.effects.values()) {
      if (
        def.displayName.toLowerCase().includes(lowerQuery) ||
        def.category.toLowerCase().includes(lowerQuery)
      ) {
        results.push(def)
      }
    }
    return Object.freeze(results)
  }

  /** Number of registered effects. */
  get size(): number {
    return this.effects.size
  }

  /** Remove all registered effects. Primarily for test teardown. */
  clear(): void {
    this.effects.clear()
  }
}
