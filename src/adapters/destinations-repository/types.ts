import type { Queryable } from '../pg'
import type { Destination } from '../../types/entities'

export type DestinationKind = 'place' | 'world'
export type DestinationOrderBy = 'like_score' | 'updated_at' | 'created_at'

export type DestinationListFilters = {
  search?: string
  categories?: string[]
  positions?: string[]
  worldNames?: string[]
  ids?: string[]
  kinds?: DestinationKind[]
  only_highlighted?: boolean
  only_favorites?: boolean
  owner?: string
  user?: string
  order_by?: DestinationOrderBy
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface IDestinationsRepository {
  /** UNION of places + worlds projected to the common Destination shape. */
  findWithAggregates(client: Queryable, filters: DestinationListFilters): Promise<Destination[]>
  count(client: Queryable, filters: DestinationListFilters): Promise<number>
}
