import { LRUCache } from 'lru-cache'
import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'

const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 20_000

type SceneParticipantsResponse = { ok?: boolean; data?: { addresses?: string[] } }

export interface ICommsGatekeeperClient {
  /** Connected wallet addresses in the scene at a base position (empty when unconfigured/on error). */
  getSceneParticipants(basePosition: string): Promise<string[]>
  /** Connected wallet addresses in a world (empty when unconfigured/on error). */
  getWorldParticipants(worldName: string): Promise<string[]>
}

/**
 * comms-gatekeeper client for realtime scene/world occupancy. 5-minute TTL cache
 * (matching the legacy places service) and degrades to an empty list when
 * unconfigured or on error — connected-user counts are decoration, never gating.
 */
export async function createCommsGatekeeperClient(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<ICommsGatekeeperClient> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('comms-gatekeeper-client')

  const baseUrl = (await config.getString('COMMS_GATEKEEPER_URL'))?.replace(/\/$/, '')
  const cache = new LRUCache<string, string[]>({ max: CACHE_MAX, ttl: CACHE_TTL_MS })

  async function fetchParticipants(cacheKey: string, query: string): Promise<string[]> {
    if (!baseUrl) return []
    const cached = cache.get(cacheKey)
    if (cached) return cached
    try {
      const response = await fetcher.fetch(`${baseUrl}/scene-participants?${query}`)
      const body = (await response.json()) as SceneParticipantsResponse
      const addresses = body?.data?.addresses ?? []
      cache.set(cacheKey, addresses)
      return addresses
    } catch (error: any) {
      logger.warn(`Failed to fetch participants (${cacheKey}): ${error?.message ?? String(error)}`)
      return []
    }
  }

  async function getSceneParticipants(basePosition: string): Promise<string[]> {
    return fetchParticipants(`scene:${basePosition}`, new URLSearchParams({ pointer: basePosition }).toString())
  }

  async function getWorldParticipants(worldName: string): Promise<string[]> {
    return fetchParticipants(`world:${worldName}`, new URLSearchParams({ realm_name: worldName }).toString())
  }

  return { getSceneParticipants, getWorldParticipants }
}
