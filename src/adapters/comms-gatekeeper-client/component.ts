import { LRUCache } from 'lru-cache'
import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'
import type { ICommsGatekeeperClient } from './types'

const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 20_000

type SceneParticipantsResponse = { ok?: boolean; data?: { addresses?: string[] } }

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
      // Don't cache an error response as an empty list for the full TTL — let it
      // fall through to the catch so the next call retries.
      if (!response.ok) throw new Error(`unexpected status ${response.status}`)
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
