import type { AggregatePlace, PlaceStatus } from '../../types/entities'
import type { PlaceListFilters } from '../../adapters/places-repository'

export type PlaceListResult = {
  data: AggregatePlace[]
  total: number
}

export interface IPlacesComponent {
  /** A single place with the requesting user's like/favorite state; throws `PlaceNotFoundError`. */
  getPlace(id: string, user?: string, withRealmsDetail?: boolean): Promise<AggregatePlace>
  /** Filtered, paginated place list with a total count. */
  getPlaces(filters: PlaceListFilters): Promise<PlaceListResult>
  /**
   * Places by id (full aggregates) with the same order/limit/offset/search filters as the list,
   * plus a `total` counting the requested ids present (including disabled).
   */
  getPlacesByIds(ids: string[], filters?: Partial<PlaceListFilters>): Promise<PlaceListResult>
  /** Minimal status rows by id (no aggregates). */
  getPlacesStatus(ids: string[]): Promise<PlaceStatus[]>
}
