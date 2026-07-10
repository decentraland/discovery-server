import type { AppComponents } from '../../types'
import type { Destination } from '../../types/entities'
import type { DestinationListFilters } from '../../adapters/destinations-repository'

export type GetDestinationsOptions = {
  withLiveEvents?: boolean
  withConnectedUsers?: boolean
  withNextEvent?: boolean
}

export interface IDestinationsComponent {
  getDestinations(
    filters: DestinationListFilters,
    options?: GetDestinationsOptions
  ): Promise<{ data: Destination[]; total: number }>
  /** A single destination (place or world) by id, decorated per options; null if missing. */
  getDestinationById(id: string, user?: string, options?: GetDestinationsOptions): Promise<Destination | null>
}

/**
 * Unified discovery reads. The places+worlds UNION comes from the destinations
 * repository; realtime signals (live/next events, online counts, visits) are read
 * from the cached snapshots (live-events index, hotScenes/worldsLiveData, scene-stats)
 * rather than per-request queries or per-row HTTP. All decorations are opt-in and
 * best-effort, and online counts use the same source as the legacy places/worlds reads.
 */
export async function createDestinationsComponent(
  components: Pick<
    AppComponents,
    'pg' | 'destinationsRepository' | 'liveEvents' | 'hotScenes' | 'worldsLiveData' | 'sceneStats' | 'logs'
  >
): Promise<IDestinationsComponent> {
  const { pg, destinationsRepository, liveEvents, hotScenes, worldsLiveData, sceneStats } = components

  /**
   * Decorate a page of destinations in a single pass. Realtime signals come from the
   * cached snapshots (live-events index, hotScenes/worldsLiveData online counts,
   * scene-stats visits) — O(1) lookups, no per-request DB queries or per-row HTTP.
   * Online counts use the same source as the legacy places/worlds endpoints.
   */
  async function decorate(rows: Destination[], options: GetDestinationsOptions): Promise<Destination[]> {
    if (!rows.length) return rows

    const liveIds = options.withLiveEvents ? await liveEvents.getLiveEntityIds() : null
    const livePlaces = liveIds ? new Set(liveIds.placeIds) : null
    const liveWorlds = liveIds ? new Set(liveIds.worldIds) : null
    const nextEventMap = options.withNextEvent ? await liveEvents.getNextEventMap() : null

    return Promise.all(
      rows.map(async (destination) => {
        // Places carry 30-day visit counts; worlds have no scene-stats (0), matching legacy.
        const decorated: Destination = {
          ...destination,
          user_visits:
            destination.kind === 'place' && destination.base_position
              ? await sceneStats.getVisits(destination.base_position)
              : 0
        }
        if (livePlaces && liveWorlds) {
          decorated.live_event =
            destination.kind === 'place' ? livePlaces.has(destination.id) : liveWorlds.has(destination.id)
        }
        if (nextEventMap) decorated.next_event = nextEventMap[destination.id] ?? null
        if (options.withConnectedUsers) {
          decorated.user_count =
            destination.kind === 'world'
              ? await worldsLiveData.getUserCount(destination.world_name ?? destination.id)
              : destination.base_position
                ? await hotScenes.getUserCount(destination.base_position)
                : 0
        }
        return decorated
      })
    )
  }

  async function getDestinations(
    filters: DestinationListFilters,
    options: GetDestinationsOptions = {}
  ): Promise<{ data: Destination[]; total: number }> {
    // Favorites are per-user; an anonymous only_favorites query is empty.
    if (filters.only_favorites && !filters.user) return { data: [], total: 0 }
    const [rows, total] = await Promise.all([
      destinationsRepository.findWithAggregates(pg, filters),
      destinationsRepository.count(pg, filters)
    ])
    return { data: await decorate(rows, options), total }
  }

  async function getDestinationById(
    id: string,
    user?: string,
    options: GetDestinationsOptions = {}
  ): Promise<Destination | null> {
    // Single-entity read: skip the UNION COUNT(*) that getDestinations runs for `total`.
    const rows = await destinationsRepository.findWithAggregates(pg, { ids: [id], user, limit: 1 })
    if (!rows.length) return null
    const [decorated] = await decorate(rows, options)
    return decorated ?? null
  }

  return { getDestinations, getDestinationById }
}
