import type { AppComponents } from '../../types'
import type { AggregatePlace, PlaceStatus } from '../../types/entities'
import type { PlaceListFilters } from '../../adapters/places-repository'
import type { IPlacesComponent, PlaceListResult } from './types'
import { PlaceNotFoundError } from './errors'

const MAX_IDS = 100

/**
 * Place reads. Stored aggregates and per-user like/favorite state come straight
 * from the repository. Realtime user counts (hot-scenes) and Catalyst operated-
 * lands enrichment are layered in once those adapters land — they decorate the
 * result, they do not gate it.
 */
export async function createPlacesComponent(
  components: Pick<AppComponents, 'pg' | 'placesRepository' | 'logs'>
): Promise<IPlacesComponent> {
  const { pg, placesRepository } = components

  async function getPlace(id: string, user?: string): Promise<AggregatePlace> {
    const place = await placesRepository.findByIdWithAggregates(pg, id, user)
    if (!place) {
      throw new PlaceNotFoundError(id)
    }
    return place
  }

  async function getPlaces(filters: PlaceListFilters): Promise<PlaceListResult> {
    const [data, total] = await Promise.all([
      placesRepository.findWithAggregates(pg, filters),
      placesRepository.count(pg, filters)
    ])
    return { data, total }
  }

  async function getPlacesByIds(ids: string[], user?: string): Promise<AggregatePlace[]> {
    if (!ids.length) return []
    return placesRepository.findWithAggregates(pg, { ids: ids.slice(0, MAX_IDS), user, limit: MAX_IDS })
  }

  async function getPlacesStatus(ids: string[]): Promise<PlaceStatus[]> {
    return placesRepository.findByIds(pg, ids.slice(0, MAX_IDS))
  }

  return { getPlace, getPlaces, getPlacesByIds, getPlacesStatus }
}
