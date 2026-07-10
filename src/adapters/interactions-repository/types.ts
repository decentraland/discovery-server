import type { Queryable } from '../pg'

export type EntityType = 'place' | 'world' | 'event'

export type SetLikeInput = {
  entityId: string
  entityType: EntityType
  user: string
  userActivity: number
  /** true = like, false = dislike, null = clear the reaction. */
  like: boolean | null
}

export type SetFavoriteInput = {
  entityId: string
  entityType: EntityType
  user: string
  userActivity: number
  favorite: boolean
}

export interface IInteractionsRepository {
  /**
   * Row-lock the entity (place/world) for the current transaction so a concurrent
   * like/favorite can't recompute the counters from a stale snapshot and lose a write.
   * No-op for entity types without counter columns (events).
   */
  lockEntity(client: Queryable, entityType: EntityType, entityId: string): Promise<void>
  setLike(client: Queryable, input: SetLikeInput): Promise<void>
  setFavorite(client: Queryable, input: SetFavoriteInput): Promise<void>
  /** Recompute likes/dislikes/like_rate/like_score on the entity's own table (Wilson score, VP-weighted). */
  recomputeLikes(client: Queryable, entityType: EntityType, entityId: string): Promise<void>
  /** Recompute the denormalized favorites count on the entity's own table. */
  recomputeFavorites(client: Queryable, entityType: EntityType, entityId: string): Promise<void>
}
