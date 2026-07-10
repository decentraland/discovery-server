import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'

const DEFAULT_TTL_MS = 60 * 60 * 1000

type SceneStat = { last_30d?: { users?: number } }
type SceneStatsMap = Record<string, SceneStat>

export interface ISceneStatsComponent {
  /** 30-day unique-visitor count for the scene at a base position (0 if none/unconfigured). */
  getVisits(basePosition: string): Promise<number>
  /** Force a refresh of the cached scene-stats snapshot. */
  refresh(): Promise<void>
}

/**
 * Data-team scene-stats cache (collapsing the legacy modules/sceneStats +
 * entities/SceneStats implementations). Fetches the CDN `scene-stats.json` snapshot
 * with a lazy TTL (1h, matching legacy) and exposes 30-day visit counts per base
 * position; degrades to 0 when DATA_TEAM_URL is unset or on error.
 */
export async function createSceneStatsComponent(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<ISceneStatsComponent> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('scene-stats')

  const baseUrl = (await config.getString('DATA_TEAM_URL'))?.replace(/\/$/, '')
  const ttl = (await config.getNumber('SCENE_STATS_TTL_MS')) ?? DEFAULT_TTL_MS

  let visitsByPosition: SceneStatsMap = {}
  let lastRefresh = 0
  let inFlight: Promise<void> | null = null

  async function doRefresh(): Promise<void> {
    try {
      const response = await fetcher.fetch(`${baseUrl}/scenes/scene-stats.json`)
      if (!response.ok) throw new Error(`unexpected status ${response.status}`)
      visitsByPosition = ((await response.json()) as SceneStatsMap) ?? {}
      lastRefresh = Date.now()
    } catch (error: any) {
      // Back off for the TTL even on failure; keep the previous snapshot.
      lastRefresh = Date.now()
      logger.warn(`Failed to refresh scene stats: ${error?.message ?? String(error)}`)
    }
  }

  async function refresh(): Promise<void> {
    if (!baseUrl) return
    // Single-flight: a burst of stale reads shares one CDN fetch instead of stampeding it.
    if (!inFlight) inFlight = doRefresh().finally(() => (inFlight = null))
    return inFlight
  }

  async function getVisits(basePosition: string): Promise<number> {
    if (baseUrl && Date.now() - lastRefresh > ttl) await refresh()
    return visitsByPosition[basePosition]?.last_30d?.users ?? 0
  }

  return { getVisits, refresh }
}
