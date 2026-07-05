import type { AggregatePlace, PlaceStatus } from '../../types/entities'
import type { PlaceListFilters } from '../../adapters/places-repository'

export type PlaceListResult = {
  data: AggregatePlace[]
  total: number
}

export interface IPlacesComponent {
  /** A single place with the requesting user's like/favorite state; throws `PlaceNotFoundError`. */
  getPlace(id: string, user?: string): Promise<AggregatePlace>
  /** Filtered, paginated place list with a total count. */
  getPlaces(filters: PlaceListFilters): Promise<PlaceListResult>
  /** Places by id (full aggregates), preserving retro-compat with the by-ids endpoint. */
  getPlacesByIds(ids: string[], user?: string): Promise<AggregatePlace[]>
  /** Minimal status rows by id (no aggregates). */
  getPlacesStatus(ids: string[]): Promise<PlaceStatus[]>
}
