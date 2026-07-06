import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'

const MEMBERS_PAGE_SIZE = 100

export type Community = { id: string; name: string; ownerAddress: string }

export interface ICommunitiesClient {
  /** Whether the communities API is configured (URL present). */
  readonly enabled: boolean
  /** Communities the given wallet owns or moderates (empty on unconfigured/error). */
  getManagedCommunities(address: string): Promise<Community[]>
  /** Member wallet addresses of a community, paginated (empty on unconfigured/error). */
  getCommunityMembers(communityId: string): Promise<string[]>
}

/**
 * social-api communities client. Used to validate community ownership on event
 * create and to fan out EVENT_STARTED to community members. Authenticated with
 * the admin bearer token; degrades to empty on unconfigured/error so callers can
 * decide whether to skip (dev/test) or reject (prod, when enabled).
 */
export async function createCommunitiesClient(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<ICommunitiesClient> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('communities-client')

  const baseUrl = (await config.getString('COMMUNITIES_API_URL'))?.replace(/\/$/, '')
  const token = await config.getString('COMMUNITIES_API_ADMIN_TOKEN')
  const headers = token ? { authorization: `Bearer ${token}` } : undefined

  async function getManagedCommunities(address: string): Promise<Community[]> {
    if (!baseUrl) return []
    try {
      const response = await fetcher.fetch(`${baseUrl}/v1/communities/${address.toLowerCase()}/managed`, { headers })
      const body = (await response.json()) as { data?: Community[] | { results?: Community[] } }
      const data = Array.isArray(body?.data) ? body.data : (body?.data?.results ?? [])
      return data
    } catch (error: any) {
      logger.warn(`Failed to fetch managed communities for ${address}: ${error?.message ?? String(error)}`)
      return []
    }
  }

  async function getCommunityMembers(communityId: string): Promise<string[]> {
    if (!baseUrl) return []
    const members: string[] = []
    try {
      let page = 1
      let pages = 1
      do {
        const offset = (page - 1) * MEMBERS_PAGE_SIZE
        const url = `${baseUrl}/v1/communities/${communityId}/members?limit=${MEMBERS_PAGE_SIZE}&offset=${offset}`
        const response = await fetcher.fetch(url, { headers })
        const body = (await response.json()) as {
          data?: { results?: Array<{ memberAddress?: string }>; pages?: number; page?: number }
        }
        for (const member of body?.data?.results ?? []) {
          if (member.memberAddress) members.push(member.memberAddress.toLowerCase())
        }
        pages = body?.data?.pages ?? 1
        page = (body?.data?.page ?? page) + 1
      } while (page <= pages)
      return members
    } catch (error: any) {
      logger.warn(`Failed to fetch members for community ${communityId}: ${error?.message ?? String(error)}`)
      return members
    }
  }

  return { enabled: !!baseUrl, getManagedCommunities, getCommunityMembers }
}
