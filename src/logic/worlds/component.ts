import type { AppComponents } from '../../types'
import type { AggregateWorld } from '../../types/entities'
import type { WorldListFilters } from '../../adapters/worlds-repository'
import type { IWorldsComponent, WorldListResult } from './types'
import { WorldNotFoundError } from './errors'

/**
 * World reads. Live user counts (worlds-content-server) are layered in once that
 * adapter lands — they decorate the result, they do not gate it.
 */
export async function createWorldsComponent(
  components: Pick<AppComponents, 'pg' | 'worldsRepository' | 'logs'>
): Promise<IWorldsComponent> {
  const { pg, worldsRepository } = components

  async function getWorld(id: string, user?: string): Promise<AggregateWorld> {
    const world = await worldsRepository.findByIdWithAggregates(pg, id, user)
    if (!world) {
      throw new WorldNotFoundError(id)
    }
    return world
  }

  async function getWorlds(filters: WorldListFilters): Promise<WorldListResult> {
    const [data, total] = await Promise.all([
      worldsRepository.findWithAggregates(pg, filters),
      worldsRepository.count(pg, filters)
    ])
    return { data, total }
  }

  async function getWorldNames(): Promise<string[]> {
    return worldsRepository.findNames(pg)
  }

  return { getWorld, getWorlds, getWorldNames }
}
