import type { AppComponents } from '../../types'
import type { Destination } from '../../types/entities'
import type { DestinationListFilters } from '../../adapters/destinations-repository'

export type GetDestinationsOptions = { withLiveEvents?: boolean }

export interface IDestinationsComponent {
  getDestinations(
    filters: DestinationListFilters,
    options?: GetDestinationsOptions
  ): Promise<{ data: Destination[]; total: number }>
}

/**
 * Unified discovery reads. The places+worlds UNION comes from the destinations
 * repository; live-event flags are decorated in-process from the events domain
 * (replacing the legacy HTTP Events-API client). Realtime online counts are
 * layered in with the hot-scenes / worlds-live-data adapters.
 */
export async function createDestinationsComponent(
  components: Pick<AppComponents, 'pg' | 'destinationsRepository' | 'eventsRepository' | 'logs'>
): Promise<IDestinationsComponent> {
  const { pg, destinationsRepository, eventsRepository } = components

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

  async function getDestinations(
    filters: DestinationListFilters,
    options: GetDestinationsOptions = {}
  ): Promise<{ data: Destination[]; total: number }> {
    const [rows, total] = await Promise.all([
      destinationsRepository.findWithAggregates(pg, filters),
      destinationsRepository.count(pg, filters)
    ])
    const data = options.withLiveEvents ? await decorateLiveEvents(rows) : rows
    return { data, total }
  }

  return { getDestinations }
}
