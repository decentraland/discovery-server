import type { AppComponents } from '../../types'
import type { Destination } from '../../types/entities'
import type { DestinationListFilters } from '../../adapters/destinations-repository'

export type GetDestinationsOptions = { withLiveEvents?: boolean; withConnectedUsers?: boolean }

export interface IDestinationsComponent {
  getDestinations(
    filters: DestinationListFilters,
    options?: GetDestinationsOptions
  ): Promise<{ data: Destination[]; total: number }>
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
    'pg' | 'destinationsRepository' | 'eventsRepository' | 'commsGatekeeperClient' | 'logs'
  >
): Promise<IDestinationsComponent> {
  const { pg, destinationsRepository, eventsRepository, commsGatekeeperClient } = components

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
    const [rows, total] = await Promise.all([
      destinationsRepository.findWithAggregates(pg, filters),
      destinationsRepository.count(pg, filters)
    ])
    let data = rows
    if (options.withLiveEvents) data = await decorateLiveEvents(data)
    if (options.withConnectedUsers) data = await decorateConnectedUsers(data)
    return { data, total }
  }

  return { getDestinations }
}
