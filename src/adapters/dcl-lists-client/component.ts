import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'
import type { IDclListsClient } from './types'

/**
 * dcl-lists client for the curated Point-of-Interest positions. Degrades to an
 * empty list when DCL_LISTS_URL is unset or on error — the POI sync then makes
 * no changes rather than clearing every POI.
 */
export async function createDclListsClient(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<IDclListsClient> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('dcl-lists-client')

  const baseUrl = (await config.getString('DCL_LISTS_URL'))?.replace(/\/$/, '')

  async function getPois(): Promise<string[]> {
    if (!baseUrl) return []
    try {
      const response = await fetcher.fetch(`${baseUrl}/pois`, { method: 'POST' })
      const body = (await response.json()) as { data?: string[] }
      return body?.data ?? []
    } catch (error: any) {
      logger.warn(`Failed to fetch POIs: ${error?.message ?? String(error)}`)
      return []
    }
  }

  return { getPois }
}
