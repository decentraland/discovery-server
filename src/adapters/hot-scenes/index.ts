import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'

const DEFAULT_TTL_MS = 60 * 1000

export type HotScene = {
  id: string
  name: string
  baseCoords: [number, number]
  usersTotalCount: number
  parcels: [number, number][]
}

export interface IHotScenesComponent {
  /** Realtime user count for the scene at a base position (0 if none/unconfigured). */
  getUserCount(basePosition: string): Promise<number>
  /** Base positions ("x,y") of scenes that currently have users — drives most_active ordering. */
  getActivePositions(): Promise<string[]>
  /** Force a refresh of the cached hot-scenes snapshot (used by the refresh cron). */
  refresh(): Promise<void>
}

/**
 * Single hot-scenes cache (collapsing the legacy places service's three
 * implementations: modules/hotScenes, entities/RealmProvider/utils and
 * api/RealmProvider). Fetches the realm-provider `/hot-scenes` snapshot with a
 * lazy TTL and an explicit refresh for the cron; degrades to empty when
 * REALM_PROVIDER_URL is unset or on error.
 */
export async function createHotScenesComponent(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<IHotScenesComponent> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('hot-scenes')

  const baseUrl = (await config.getString('REALM_PROVIDER_URL'))?.replace(/\/$/, '')
  const ttl = (await config.getNumber('HOT_SCENES_TTL_MS')) ?? DEFAULT_TTL_MS

  let countByPosition = new Map<string, number>()
  let lastRefresh = 0
  let inFlight: Promise<void> | null = null

  function position(scene: HotScene): string {
    return `${scene.baseCoords[0]},${scene.baseCoords[1]}`
  }

  async function doRefresh(): Promise<void> {
    try {
      const response = await fetcher.fetch(`${baseUrl}/hot-scenes`)
      // Don't overwrite the good snapshot with an error response, and don't parse
      // an error body as scenes.
      if (!response.ok) throw new Error(`unexpected status ${response.status}`)
      const scenes = (await response.json()) as HotScene[]
      const next = new Map<string, number>()
      for (const scene of scenes ?? []) {
        if (Array.isArray(scene.baseCoords)) next.set(position(scene), scene.usersTotalCount ?? 0)
      }
      countByPosition = next
      lastRefresh = Date.now()
    } catch (error: any) {
      // Back off for the TTL even on failure so a dead upstream isn't hammered by
      // every request; the previous snapshot (possibly empty) is kept.
      lastRefresh = Date.now()
      logger.warn(`Failed to refresh hot scenes: ${error?.message ?? String(error)}`)
    }
  }

  async function refresh(): Promise<void> {
    if (!baseUrl) return
    // Single-flight: per-row reads over a stale cache share one upstream fetch.
    if (!inFlight) inFlight = doRefresh().finally(() => (inFlight = null))
    return inFlight
  }

  async function ensureFresh(): Promise<void> {
    if (baseUrl && Date.now() - lastRefresh > ttl) await refresh()
  }

  async function getUserCount(basePosition: string): Promise<number> {
    await ensureFresh()
    return countByPosition.get(basePosition) ?? 0
  }

  async function getActivePositions(): Promise<string[]> {
    await ensureFresh()
    return [...countByPosition.entries()].filter(([, count]) => count > 0).map(([pos]) => pos)
  }

  return { getUserCount, getActivePositions, refresh }
}
