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
  components: Pick<AppComponents, 'pg' | 'placesRepository' | 'hotScenes' | 'sceneStats' | 'catalystClient' | 'logs'>
): Promise<IPlacesComponent> {
  const { pg, placesRepository, hotScenes, sceneStats, catalystClient } = components

  async function decorate(place: AggregatePlace): Promise<AggregatePlace> {
    // user_visits: base position first, then any parcel of a multi-parcel scene (legacy fallback).
    const [user_count, user_visits] = await Promise.all([
      hotScenes.getUserCount(place.base_position),
      sceneStats.getVisitsForPositions([place.base_position, ...(place.positions ?? [])])
    ])
    return { ...place, user_count, user_visits }
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

    // Legacy `owner` semantics: match places the wallet owns OR operates (owned +
    // estate + rented parcels), resolved via Catalyst. Empty → exact-owner match only.
    const operatedPositions = filters.owner ? await catalystClient.getOperatedPositions(filters.owner) : undefined

    // most_active is sorted by realtime connected-user count (not a DB column), so the active
    // rows are fetched, decorated with their live count, sorted here, then paginated — matching
    // legacy getPlaceMostActiveList (total is the active-set size).
    if (filters.order_by === 'most_active') {
      const mostActivePositions = await hotScenes.getActivePositions()
      const activeFilters = { ...filters, operatedPositions, mostActivePositions, limit: undefined, offset: undefined }
      const rows = await placesRepository.findWithAggregates(pg, activeFilters)
      const decorated = await Promise.all(rows.map(decorate))
      decorated.sort((a, b) => (b.user_count ?? 0) - (a.user_count ?? 0))
      const start = Math.max(filters.offset ?? 0, 0)
      const limit = filters.limit ?? MAX_IDS
      return { data: decorated.slice(start, start + limit), total: decorated.length }
    }

    const effectiveFilters = { ...filters, operatedPositions }
    const [rows, total] = await Promise.all([
      placesRepository.findWithAggregates(pg, effectiveFilters),
      placesRepository.count(pg, effectiveFilters)
    ])
    const data = await Promise.all(rows.map(decorate))
    return { data, total }
  }

  async function getPlacesByIds(ids: string[], filters: Partial<PlaceListFilters> = {}): Promise<PlaceListResult> {
    const validIds = ids.filter(isPlaceId).slice(0, MAX_IDS)
    if (!validIds.length) return { data: [], total: 0 }
    // Legacy POST /api/places applies the same order/limit/offset/search as the GET list,
    // and reports `total` as the number of requested ids present (including disabled).
    const [rows, total] = await Promise.all([
      placesRepository.findWithAggregates(pg, { ...filters, ids: validIds, limit: filters.limit ?? MAX_IDS }),
      placesRepository.countByIds(pg, validIds)
    ])
    const data = await Promise.all(rows.map(decorate))
    return { data, total }
  }

  async function getPlacesStatus(ids: string[]): Promise<PlaceStatus[]> {
    return placesRepository.findByIds(pg, ids.filter(isPlaceId).slice(0, MAX_IDS))
  }

  async function getPlaceCategories(id: string): Promise<string[]> {
    // A malformed id can't be a place (404, discovery's kept choice); a valid-but-unknown id
    // returns [] from the join (legacy returned 200 with no categories for it).
    if (!isPlaceId(id)) throw new PlaceNotFoundError(id)
    return placesRepository.findCategoriesById(pg, id)
  }

  return { getPlace, getPlaces, getPlacesByIds, getPlacesStatus, getPlaceCategories }
}
