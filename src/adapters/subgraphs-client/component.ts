import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'
import type { ISubgraphsClient } from './types'

const DCL_NAME_SUFFIX = '.dcl.eth'

/**
 * Marketplace + ENS subgraph client for resolving the on-chain owner of a world
 * name during world ingestion. Degrades to undefined so a subgraph outage leaves
 * the world's stored owner untouched.
 */
export async function createSubgraphsClient(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<ISubgraphsClient> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('subgraphs-client')

  const marketplaceUrl = (await config.getString('MARKETPLACE_SUBGRAPH_URL'))?.replace(/\/$/, '')
  const ensUrl = (await config.getString('ENS_SUBGRAPH_URL'))?.replace(/\/$/, '')

  async function query<T>(url: string, gql: string, variables: Record<string, unknown>): Promise<T | undefined> {
    const response = await fetcher.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: gql, variables })
    })
    if (!response.ok) throw new Error(`unexpected status ${response.status}`)
    const body = (await response.json()) as { data?: T }
    return body?.data
  }

  async function getNameOwner(worldName: string): Promise<string | undefined> {
    const name = worldName.toLowerCase()
    try {
      if (name.endsWith(DCL_NAME_SUFFIX)) {
        if (!marketplaceUrl) return undefined
        const subdomain = name.slice(0, -DCL_NAME_SUFFIX.length)
        const data = await query<{ nfts?: Array<{ owner?: { address?: string } }> }>(
          marketplaceUrl,
          'query getOwner($domains: [String!]) { nfts(first: 1, where: { searchText_in: $domains, category: ens }) { owner { address } } }',
          { domains: [subdomain] }
        )
        return data?.nfts?.[0]?.owner?.address?.toLowerCase()
      }
      if (!ensUrl) return undefined
      const data = await query<{ domains?: Array<{ owner?: { id?: string }; wrappedOwner?: { id?: string } }> }>(
        ensUrl,
        'query getOwner($domains: [String]) { domains(where: { name_in: $domains }) { owner { id } wrappedOwner { id } } }',
        { domains: [name] }
      )
      const domain = data?.domains?.[0]
      return (domain?.wrappedOwner?.id ?? domain?.owner?.id)?.toLowerCase()
    } catch (error: any) {
      logger.warn(`Failed to resolve owner for ${worldName}: ${error?.message ?? String(error)}`)
      return undefined
    }
  }

  return { getNameOwner }
}
