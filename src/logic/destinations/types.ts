import type { Destination } from '../../types/entities'
import type { DestinationListFilters } from '../../adapters/destinations-repository'

export type GetDestinationsOptions = {
  withLiveEvents?: boolean
  withConnectedUsers?: boolean
  withNextEvent?: boolean
  withRealmsDetail?: boolean
}

export interface IDestinationsComponent {
  getDestinations(
    filters: DestinationListFilters,
    options?: GetDestinationsOptions
  ): Promise<{ data: Destination[]; total: number }>
  /** A single destination (place or world) by id, decorated per options; null if missing. */
  getDestinationById(id: string, user?: string, options?: GetDestinationsOptions): Promise<Destination | null>
}
