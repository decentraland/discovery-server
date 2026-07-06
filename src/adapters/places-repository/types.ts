import type { Queryable } from '../pg'
import type { AggregatePlace, Place, PlaceStatus } from '../../types/entities'

export type PlaceListOrderBy = 'like_score' | 'updated_at' | 'created_at' | 'most_active'
export type OrderDirection = 'asc' | 'desc'

export type PlaceListFilters = {
  search?: string
  positions?: string[]
  categories?: string[]
  only_highlighted?: boolean
  only_favorites?: boolean
  owner?: string
  creator_address?: string
  sdk?: string
  ids?: string[]
  names?: string[]
  /** Requesting wallet, for per-user like/favorite state and only_favorites. */
  user?: string
  order_by?: PlaceListOrderBy
  order?: OrderDirection
  /** Base positions of currently-active scenes; enables `most_active` ordering. */
  mostActivePositions?: string[]
  limit?: number
  offset?: number
}

/** Fields required to insert/upsert a place (used by tests and the ingestion consumer). */
export type UpsertPlaceInput = Partial<Omit<Place, 'created_at' | 'updated_at'>> & {
  id?: string
  base_position: string
}

/** Moderation/admin-updatable fields. */
export type PlaceModerationFields = Partial<
  Pick<Place, 'content_rating' | 'highlighted' | 'highlighted_image' | 'disabled' | 'disabled_reason' | 'ranking'>
>

/** Scene data extracted from a Catalyst deployment, keyed on base_position. */
export type ScenePlaceInput = {
  base_position: string
  positions: string[]
  title: string | null
  description: string | null
  image: string | null
  owner: string | null
  contact_name: string | null
  contact_email: string | null
  categories: string[]
  sdk: string | null
  deployed_at: string
}

export interface IPlacesRepository {
  findByIdWithAggregates(client: Queryable, id: string, user?: string): Promise<AggregatePlace | null>
  findByIds(client: Queryable, ids: string[]): Promise<PlaceStatus[]>
  findWithAggregates(client: Queryable, filters: PlaceListFilters): Promise<AggregatePlace[]>
  count(client: Queryable, filters: PlaceListFilters): Promise<number>
  insert(client: Queryable, input: UpsertPlaceInput): Promise<Place>
  /** Apply moderation/admin field updates; sets disabled_at when disabling. */
  updateModeration(client: Queryable, id: string, fields: PlaceModerationFields): Promise<Place | null>
  /** Upsert a genesis place from a scene deployment (matched on base_position); re-enables it. */
  upsertScene(client: Queryable, scene: ScenePlaceInput): Promise<Place>
}
