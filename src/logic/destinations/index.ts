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
 * repository; live-event flags are decorated in-process from the events domain
 * (replacing the legacy HTTP Events-API client) and realtime connected-user
 * counts from comms-gatekeeper. Both decorations are opt-in and best-effort.
 */
export async function createDestinationsComponent(
  components: Pick<
    AppComponents,
    'pg' | 'destinationsRepository' | 'eventsRepository' | 'commsGatekeeperClient' | 'sceneStats' | 'logs'
  >
): Promise<IDestinationsComponent> {
  const { pg, destinationsRepository, eventsRepository, commsGatekeeperClient, sceneStats } = components

  async function decorateVisits(destinations: Destination[]): Promise<Destination[]> {
    // Places carry 30-day visit counts; worlds have no scene-stats (0), matching legacy.
    return Promise.all(
      destinations.map(async (destination) => ({
        ...destination,
        user_visits:
          destination.kind === 'place' && destination.base_position
            ? await sceneStats.getVisits(destination.base_position)
            : 0
      }))
    )
  }

  async function decorateLiveEvents(destinations: Destination[]): Promise<Destination[]> {
    if (!destinations.length) return destinations
    const { placeIds, worldIds } = await eventsRepository.getLiveEntityIds(pg)
    const livePlaces = new Set(placeIds)
    const liveWorlds = new Set(worldIds)
    return destinations.map((destination) => ({
      ...destination,
      live_event: destination.kind === 'place' ? livePlaces.has(destination.id) : liveWorlds.has(destination.id)
    }))
  }

  async function decorateNextEvent(destinations: Destination[]): Promise<Destination[]> {
    if (!destinations.length) return destinations
    const placeIds = destinations.filter((d) => d.kind === 'place').map((d) => d.id)
    const worldIds = destinations.filter((d) => d.kind === 'world').map((d) => d.id)
    const byEntity = await eventsRepository.getNextEventsForEntities(pg, placeIds, worldIds)
    return destinations.map((destination) => ({ ...destination, next_event: byEntity[destination.id] ?? null }))
  }

  async function decorateConnectedUsers(destinations: Destination[]): Promise<Destination[]> {
    return Promise.all(
      destinations.map(async (destination) => {
        const participants =
          destination.kind === 'world'
            ? await commsGatekeeperClient.getWorldParticipants(destination.world_name ?? destination.id)
            : destination.base_position
              ? await commsGatekeeperClient.getSceneParticipants(destination.base_position)
              : []
        return { ...destination, user_count: participants.length }
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
    let data = await decorateVisits(rows)
    if (options.withLiveEvents) data = await decorateLiveEvents(data)
    if (options.withNextEvent) data = await decorateNextEvent(data)
    if (options.withConnectedUsers) data = await decorateConnectedUsers(data)
    return { data, total }
  }

  async function getDestinationById(
    id: string,
    user?: string,
    options: GetDestinationsOptions = {}
  ): Promise<Destination | null> {
    const { data } = await getDestinations({ ids: [id], user, limit: 1 }, options)
    return data[0] ?? null
  }

  return { getDestinations, getDestinationById }
}
