import type { Queryable } from '../pg'
import type { AggregateWorld, World } from '../../types/entities'

export type WorldListOrderBy = 'like_score' | 'updated_at' | 'created_at'
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

export interface IWorldsRepository {
  findByIdWithAggregates(client: Queryable, id: string, user?: string): Promise<AggregateWorld | null>
  findWithAggregates(client: Queryable, filters: WorldListFilters): Promise<AggregateWorld[]>
  count(client: Queryable, filters: WorldListFilters): Promise<number>
  findNames(client: Queryable): Promise<string[]>
  upsert(client: Queryable, input: UpsertWorldInput): Promise<World>
}
