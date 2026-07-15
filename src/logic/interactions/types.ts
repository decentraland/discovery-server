import type { EntityType } from '../../adapters/interactions-repository'

export type LikeCommand = {
  entityId: string
  entityType: EntityType
  user: string
  /** Snapshot voting power; supplied by the caller (fetched via the snapshot adapter). */
  userActivity?: number
  like: boolean | null
}

export type FavoriteCommand = {
  entityId: string
  entityType: EntityType
  user: string
  userActivity?: number
  favorite: boolean
}

export interface IInteractionsComponent {
  /** Record a like/dislike/clear and recompute the entity's aggregates atomically. */
  setLike(command: LikeCommand): Promise<void>
  /** Record/remove a favorite and recompute the entity's favorites count atomically. */
  setFavorite(command: FavoriteCommand): Promise<void>
}
