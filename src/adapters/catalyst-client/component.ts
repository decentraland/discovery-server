import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'
import type { ICatalystClient, SceneEntity } from './types'

const PAGE_SIZE = 100
// Genesis City is ~90k parcels total, so no wallet operates more than this; the cap only
// bounds a misbehaving lambda that never returns a short page.
const MAX_PAGES = 1000

type LandPermission = { x: string; y: string }
type LandsPermissionsResponse = { elements?: LandPermission[] }
type ProfileResponse = { avatars?: Array<{ name?: string }> }

/**
 * Catalyst lambdas client. Backs the `owner=` place filter: the lambda returns a
 * flat, already-expanded list of every parcel the address controls, which is mapped
 * to `"x,y"` strings. Degrades to an empty list (owner filter collapses to an exact
 * `owner =` match) when unconfigured or on error.
 */
export async function createCatalystClient(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<ICatalystClient> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('catalyst-client')

  const baseUrl = (await config.getString('CATALYST_URL'))?.replace(/\/$/, '')

  async function getOperatedPositions(address: string): Promise<string[]> {
    if (!baseUrl) return []
    // `owner=` is unauthenticated user input; reject anything that isn't a plain eth address
    // so it can't be used for path/query injection into the Catalyst host.
    const wallet = address.toLowerCase()
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) return []
    const positions: string[] = []
    try {
      let page = 0
      let received = PAGE_SIZE
      // The lambda paginates; a short page (or an empty one) ends the walk. MAX_PAGES
      // is a safety bound so a lambda that always returns a full page can't loop forever.
      while (received === PAGE_SIZE && page < MAX_PAGES) {
        const url = `${baseUrl}/lambdas/users/${encodeURIComponent(wallet)}/lands-permissions?pageNum=${page}&pageSize=${PAGE_SIZE}`
        const response = await fetcher.fetch(url)
        if (!response.ok) throw new Error(`unexpected status ${response.status}`)
        const body = (await response.json()) as LandsPermissionsResponse
        const elements = body?.elements ?? []
        for (const land of elements) {
          if (land.x !== undefined && land.y !== undefined) positions.push(`${land.x},${land.y}`)
        }
        received = elements.length
        page += 1
      }
      if (page >= MAX_PAGES) logger.warn(`operated-lands paging hit the ${MAX_PAGES}-page cap for ${address}`)
      return positions
    } catch (error: any) {
      logger.warn(`Failed to fetch operated lands for ${address}: ${error?.message ?? String(error)}`)
      return positions
    }
  }

  async function getProfileName(address: string): Promise<string | null> {
    if (!baseUrl) return null
    const wallet = address.toLowerCase()
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) return null
    try {
      const response = await fetcher.fetch(`${baseUrl}/lambdas/profiles/${encodeURIComponent(wallet)}`)
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return null
      }
      const body = (await response.json()) as ProfileResponse
      return body?.avatars?.[0]?.name ?? null
    } catch (error: any) {
      logger.warn(`Failed to fetch profile name for ${address}: ${error?.message ?? String(error)}`)
      return null
    }
  }

  async function getEntityById(contentServerUrl: string, entityId: string): Promise<SceneEntity | null> {
    // entityId is a content hash; reject anything with path/query metacharacters so it
    // can't escape the /contents/ path of the (event-supplied) content server.
    if (!contentServerUrl || !/^[a-zA-Z0-9]+$/.test(entityId)) return null
    try {
      const response = await fetcher.fetch(`${contentServerUrl.replace(/\/+$/, '')}/contents/${entityId}`)
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new Error(`unexpected status ${response.status}`)
      }
      return (await response.json()) as SceneEntity
    } catch (error: any) {
      logger.warn(`Failed to fetch entity ${entityId}: ${error?.message ?? String(error)}`)
      return null
    }
  }

  return { getOperatedPositions, getProfileName, getEntityById }
}
