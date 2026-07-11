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
  /** `"x,y"` parcels the owner operates (owned/estate/rented); widens the owner filter. */
  operatedPositions?: string[]
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

/** Scene data extracted from a deployment, ready to insert/update as a place row. */
export type ScenePlaceInput = {
  base_position: string
  positions: string[]
  title: string | null
  description: string | null
  image: string | null
  owner: string | null
  creator_address: string | null
  contact_name: string | null
  contact_email: string | null
  content_rating: string
  categories: string[]
  sdk: string | null
  deployed_at: string
  world: boolean
  world_id: string | null
  world_name: string | null
  disabled: boolean
  disabled_reason: string | null
}

export interface IPlacesRepository {
  /** Row-lock a place for the current transaction (FOR UPDATE) so a read-then-write can't race. */
  lockById(client: Queryable, id: string): Promise<void>
  findByIdWithAggregates(client: Queryable, id: string, user?: string): Promise<AggregatePlace | null>
  findByIds(client: Queryable, ids: string[]): Promise<PlaceStatus[]>
  /** Count how many of `ids` exist in the table, including disabled (POST /api/places `total`). */
  countByIds(client: Queryable, ids: string[]): Promise<number>
  findWithAggregates(client: Queryable, filters: PlaceListFilters): Promise<AggregatePlace[]>
  count(client: Queryable, filters: PlaceListFilters): Promise<number>
  insert(client: Queryable, input: UpsertPlaceInput): Promise<Place>
  /** Apply moderation/admin field updates; sets disabled_at when disabling. */
  updateModeration(client: Queryable, id: string, fields: PlaceModerationFields): Promise<Place | null>
  /** A place's category slugs from the authoritative `place_categories` join ([] if none/unknown). */
  findCategoriesById(client: Queryable, id: string): Promise<string[]>
  /** Enabled genesis (non-world) places whose positions overlap any of `positions`. */
  findEnabledByPositions(client: Queryable, positions: string[]): Promise<Place[]>
  /** Active places of a world whose positions overlap any of `positions` (world identity by overlap). */
  findActiveByWorldIdAndPositions(client: Queryable, worldId: string, positions: string[]): Promise<Place[]>
  /** Insert a new place from a scene deployment (computes textsearch). */
  insertScene(client: Queryable, scene: ScenePlaceInput): Promise<Place>
  /** Update an existing place (by id) from a scene deployment (recomputes textsearch); re-enables unless opted out. */
  updateScene(client: Queryable, id: string, scene: ScenePlaceInput): Promise<Place>
  /** Disable the given places with a reason. Returns the count disabled. */
  disablePlaces(client: Queryable, ids: string[], reason: string): Promise<number>
  /** Disable ALL of a world's places deployed before `before` (full world undeployment). Returns the count. */
  disableByWorldId(client: Queryable, worldId: string, before: Date): Promise<number>
  /** Disable a world's places at the given base positions deployed before `before`. Returns the count disabled. */
  disableByWorldIdAndPositions(
    client: Queryable,
    worldId: string,
    basePositions: string[],
    before: Date
  ): Promise<number>
  /** Distinct occupied parcel positions (for the Genesis City manifest). */
  listOccupiedPositions(client: Queryable): Promise<string[]>
}
