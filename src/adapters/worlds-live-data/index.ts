import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'

const DEFAULT_TTL_MS = 60 * 1000

type WorldLiveDataResponse = { data?: { perWorld?: Array<{ users?: number; worldName?: string }> } }

export interface IWorldsLiveDataComponent {
  /** Realtime user count in a world (0 if none/unconfigured). */
  getUserCount(worldName: string): Promise<number>
  /** Force a refresh of the cached worlds live-data snapshot (used by the refresh cron). */
  refresh(): Promise<void>
}

/**
 * Single worlds live-data cache (collapsing the legacy modules/worldsLiveData +
 * entities/World/utils implementations). Fetches the worlds-content-server
 * per-world occupancy snapshot with a lazy TTL and an explicit refresh; degrades
 * to empty when WORLDS_LIVE_DATA is unset or on error.
 */
export async function createWorldsLiveDataComponent(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<IWorldsLiveDataComponent> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('worlds-live-data')

  const url = await config.getString('WORLDS_LIVE_DATA')
  const ttl = (await config.getNumber('WORLDS_LIVE_DATA_TTL_MS')) ?? DEFAULT_TTL_MS

  let usersByWorld = new Map<string, number>()
  let lastRefresh = 0

  async function refresh(): Promise<void> {
    if (!url) return
    try {
      const response = await fetcher.fetch(url)
      const body = (await response.json()) as WorldLiveDataResponse
      const next = new Map<string, number>()
      for (const entry of body?.data?.perWorld ?? []) {
        if (entry.worldName) next.set(entry.worldName.toLowerCase(), entry.users ?? 0)
      }
      usersByWorld = next
      lastRefresh = Date.now()
    } catch (error: any) {
      logger.warn(`Failed to refresh worlds live data: ${error?.message ?? String(error)}`)
    }
  }

  async function getUserCount(worldName: string): Promise<number> {
    if (url && Date.now() - lastRefresh > ttl) await refresh()
    return usersByWorld.get(worldName.toLowerCase()) ?? 0
  }

  return { getUserCount, refresh }
}
