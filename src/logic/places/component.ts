import type { AppComponents } from '../../types'
import type { AggregatePlace, PlaceStatus } from '../../types/entities'
import type { PlaceListFilters } from '../../adapters/places-repository'
import { isPlaceId } from '../entity-id'
import type { IPlacesComponent, PlaceListResult } from './types'
import { PlaceNotFoundError } from './errors'

const MAX_IDS = 100

/**
 * Place reads. Stored aggregates and per-user like/favorite state come from the
 * repository; realtime connected-user counts are decorated from the hot-scenes
 * cache, and `most_active` ordering is resolved by feeding the cache's active
 * base positions into the query. Enrichment is best-effort — it decorates the
 * result, never gates it.
 */
export async function createPlacesComponent(
  components: Pick<AppComponents, 'pg' | 'placesRepository' | 'hotScenes' | 'logs'>
): Promise<IPlacesComponent> {
  const { pg, placesRepository, hotScenes } = components

  async function decorate(place: AggregatePlace): Promise<AggregatePlace> {
    return { ...place, user_count: await hotScenes.getUserCount(place.base_position) }
  }

  async function getPlace(id: string, user?: string): Promise<AggregatePlace> {
    // Place ids are uuids; a non-uuid can't exist (and would crash the uuid cast).
    if (!isPlaceId(id)) throw new PlaceNotFoundError(id)
    const place = await placesRepository.findByIdWithAggregates(pg, id, user)
    if (!place) {
      throw new PlaceNotFoundError(id)
    }
    return decorate(place)
  }

  async function getPlaces(filters: PlaceListFilters): Promise<PlaceListResult> {
    // Legacy parity: favorites for a specific user only; anonymous → empty.
    if (filters.only_favorites && !filters.user) return { data: [], total: 0 }
    const effectiveFilters =
      filters.order_by === 'most_active'
        ? { ...filters, mostActivePositions: await hotScenes.getActivePositions() }
        : filters
    const [rows, total] = await Promise.all([
      placesRepository.findWithAggregates(pg, effectiveFilters),
      placesRepository.count(pg, effectiveFilters)
    ])
    const data = await Promise.all(rows.map(decorate))
    return { data, total }
  }

  async function getPlacesByIds(ids: string[], user?: string): Promise<AggregatePlace[]> {
    const validIds = ids.filter(isPlaceId).slice(0, MAX_IDS)
    if (!validIds.length) return []
    const rows = await placesRepository.findWithAggregates(pg, { ids: validIds, user, limit: MAX_IDS })
    return Promise.all(rows.map(decorate))
  }

  async function getPlacesStatus(ids: string[]): Promise<PlaceStatus[]> {
    return placesRepository.findByIds(pg, ids.filter(isPlaceId).slice(0, MAX_IDS))
  }

  return { getPlace, getPlaces, getPlacesByIds, getPlacesStatus }
}
