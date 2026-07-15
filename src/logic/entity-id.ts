import type { EntityType } from '../adapters/interactions-repository'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A place id is a UUID; a world id is a name (e.g. `foo.dcl.eth`). */
export function isPlaceId(entityId: string): boolean {
  return UUID_RE.test(entityId)
}

/** Resolve whether a polymorphic entity id refers to a place or a world. */
export function resolveEntityType(entityId: string): Extract<EntityType, 'place' | 'world'> {
  return isPlaceId(entityId) ? 'place' : 'world'
}
