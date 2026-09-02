import type { AppComponents } from '../../types'
import { sanitizePlainText } from '../content-sanitization'
import type { ILiveEventsComponent, LiveEntityIds, NextEvent } from './types'

const DEFAULT_TTL_MS = 20 * 1000

/**
 * Live-events snapshot cache. Destination discovery reads decorate every list with
 * "is there a live event here" and "what is the next event here", which otherwise
 * scans the events table on every request. This holds both as periodically-refreshed
 * in-memory snapshots (lazy TTL + single-flight), matching the hotScenes/worldsLiveData
 * pattern, so the hot read path becomes O(1) set/map lookups. Degrades to the previous
 * snapshot on a query error.
 */
export async function createLiveEventsComponent(
  components: Pick<AppComponents, 'pg' | 'eventsRepository' | 'config' | 'logs'>
): Promise<ILiveEventsComponent> {
  const { pg, eventsRepository, config } = components
  const logger = components.logs.getLogger('live-events')
  const ttl = (await config.getNumber('LIVE_EVENTS_TTL_MS')) ?? DEFAULT_TTL_MS

  let liveEntityIds: LiveEntityIds = { placeIds: [], worldIds: [] }
  let nextEventMap: Record<string, NextEvent> = {}
  let lastRefresh = 0
  let inFlight: Promise<void> | null = null

  async function doRefresh(): Promise<void> {
    try {
      const [ids, next] = await Promise.all([
        eventsRepository.getLiveEntityIds(pg),
        eventsRepository.getAllNextEvents(pg)
      ])
      liveEntityIds = ids
      // The next-event name is a user-authored label attached to destination reads; reduce it to
      // plain text here (the projection bypasses the events `serialize` boundary).
      nextEventMap = Object.fromEntries(
        Object.entries(next).map(([key, ev]) => [key, { ...ev, name: sanitizePlainText(ev.name) ?? '' }])
      )
      lastRefresh = Date.now()
    } catch (error: any) {
      // Back off for the TTL even on failure; keep the previous snapshot.
      lastRefresh = Date.now()
      logger.warn(`Failed to refresh live-events snapshot: ${error?.message ?? String(error)}`)
    }
  }

  async function refresh(): Promise<void> {
    // Single-flight: a burst of stale reads shares one refresh instead of stampeding the DB.
    if (!inFlight) inFlight = doRefresh().finally(() => (inFlight = null))
    return inFlight
  }

  async function ensureFresh(): Promise<void> {
    if (Date.now() - lastRefresh > ttl) await refresh()
  }

  async function getLiveEntityIds(): Promise<LiveEntityIds> {
    await ensureFresh()
    return liveEntityIds
  }

  async function getNextEventMap(): Promise<Record<string, NextEvent>> {
    await ensureFresh()
    return nextEventMap
  }

  return { getLiveEntityIds, getNextEventMap, refresh }
}
