import type { AggregateWorld } from '../../types/entities'
import type { WorldListFilters } from '../../adapters/worlds-repository'

export type WorldListResult = {
  data: AggregateWorld[]
  total: number
}

export interface IWorldsComponent {
  /** A single world with the requesting user's like/favorite state; throws `WorldNotFoundError`. */
  getWorld(id: string, user?: string): Promise<AggregateWorld>
  /** Filtered, paginated world list with a total count. */
  getWorlds(filters: WorldListFilters): Promise<WorldListResult>
  /** Names of worlds shown in places. */
  getWorldNames(): Promise<string[]>
}
