import type { Queryable } from '../pg'
import type { AggregateWorld, World } from '../../types/entities'

// `most_active` is accepted for legacy parity (it was the legacy default) but, as in
// the legacy service, it resolves to like_score ordering — worlds carry no activity sort key.
export type WorldListOrderBy = 'like_score' | 'updated_at' | 'created_at' | 'most_active'
export type OrderDirection = 'asc' | 'desc'

export type WorldListFilters = {
  search?: string
  names?: string[]
  categories?: string[]
  owner?: string
  only_highlighted?: boolean
  only_favorites?: boolean
  user?: string
  order_by?: WorldListOrderBy
  order?: OrderDirection
  limit?: number
  offset?: number
}

export type UpsertWorldInput = Partial<Omit<World, 'created_at' | 'updated_at'>> & {
  id: string
  world_name: string
}

/** Moderation/admin-updatable fields (worlds have no disabled state). */
export type WorldModerationFields = Partial<
  Pick<World, 'content_rating' | 'highlighted' | 'highlighted_image' | 'ranking'>
>

export interface IWorldsRepository {
  findByIdWithAggregates(client: Queryable, id: string, user?: string): Promise<AggregateWorld | null>
  findWithAggregates(client: Queryable, filters: WorldListFilters): Promise<AggregateWorld[]>
  count(client: Queryable, filters: WorldListFilters): Promise<number>
  findNames(client: Queryable): Promise<string[]>
  upsert(client: Queryable, input: UpsertWorldInput): Promise<World>
  updateModeration(client: Queryable, id: string, fields: WorldModerationFields): Promise<World | null>
}
