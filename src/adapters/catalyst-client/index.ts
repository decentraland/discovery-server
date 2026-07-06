import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'

const PAGE_SIZE = 100

type LandPermission = { x: string; y: string }
type LandsPermissionsResponse = { elements?: LandPermission[] }

export interface ICatalystClient {
  /**
   * The `"x,y"` parcel positions a wallet owns or operates (owned + estate-expanded
   * + rented), from the Catalyst `lands-permissions` lambda. Empty when unconfigured
   * or on error.
   */
  getOperatedPositions(address: string): Promise<string[]>
}

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
    const positions: string[] = []
    try {
      let page = 0
      let received = PAGE_SIZE
      // The lambda paginates; a short page (or an empty one) ends the walk.
      while (received === PAGE_SIZE) {
        const url = `${baseUrl}/lambdas/users/${address.toLowerCase()}/lands-permissions?pageNum=${page}&pageSize=${PAGE_SIZE}`
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
      return positions
    } catch (error: any) {
      logger.warn(`Failed to fetch operated lands for ${address}: ${error?.message ?? String(error)}`)
      return positions
    }
  }

  return { getOperatedPositions }
}
