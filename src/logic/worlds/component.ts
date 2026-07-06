import type { AppComponents } from '../../types'
import type { AggregateWorld } from '../../types/entities'
import type { WorldListFilters } from '../../adapters/worlds-repository'
import type { IWorldsComponent, WorldListResult } from './types'
import { WorldNotFoundError } from './errors'

/**
 * World reads. Stored aggregates and per-user state come from the repository;
 * realtime connected-user counts are decorated from the worlds-live-data cache
 * (best-effort, never gating).
 */
export async function createWorldsComponent(
  components: Pick<AppComponents, 'pg' | 'worldsRepository' | 'worldsLiveData' | 'logs'>
): Promise<IWorldsComponent> {
  const { pg, worldsRepository, worldsLiveData } = components

  async function decorate(world: AggregateWorld): Promise<AggregateWorld> {
    return { ...world, user_count: await worldsLiveData.getUserCount(world.world_name) }
  }

  async function getWorld(id: string, user?: string): Promise<AggregateWorld> {
    const world = await worldsRepository.findByIdWithAggregates(pg, id, user)
    if (!world) {
      throw new WorldNotFoundError(id)
    }
    return decorate(world)
  }

  async function getWorlds(filters: WorldListFilters): Promise<WorldListResult> {
    // Legacy parity: favorites for a specific user only; anonymous → empty.
    if (filters.only_favorites && !filters.user) return { data: [], total: 0 }
    const [rows, total] = await Promise.all([
      worldsRepository.findWithAggregates(pg, filters),
      worldsRepository.count(pg, filters)
    ])
    const data = await Promise.all(rows.map(decorate))
    return { data, total }
  }

  async function getWorldNames(): Promise<string[]> {
    return worldsRepository.findNames(pg)
  }

  return { getWorld, getWorlds, getWorldNames }
}
