import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'
import type { ILandClient, LandTile } from './types'

const DEFAULT_LAND_URL = 'https://api.decentraland.org'

/**
 * Decentraland Land API client. Used at event create to derive the parcel/estate
 * metadata and a default map image. Tile lookups degrade to null on error (create
 * still succeeds with a parcel-image default and no estate metadata); the image URL
 * builders are pure string templates.
 */
export async function createLandClient(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<ILandClient> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('land-client')

  // Tile lookups only happen when LAND_URL is configured (so tests/dev make no
  // network call); the image-url builders always resolve against a default base.
  const tileBaseUrl = (await config.getString('LAND_URL'))?.replace(/\/$/, '')
  const imageBaseUrl = tileBaseUrl ?? DEFAULT_LAND_URL

  async function getTile(x: number, y: number): Promise<LandTile | null> {
    if (!tileBaseUrl) return null
    try {
      const response = await fetcher.fetch(`${tileBaseUrl}/v2/tiles?x1=${x}&y1=${y}&x2=${x}&y2=${y}`)
      if (!response.ok) throw new Error(`unexpected status ${response.status}`)
      const body = (await response.json()) as { data?: Record<string, LandTile> } | Record<string, LandTile>
      const tiles = (body as { data?: Record<string, LandTile> }).data ?? (body as Record<string, LandTile>)
      return tiles?.[`${x},${y}`] ?? null
    } catch (error: any) {
      logger.warn(`Failed to fetch Land tile ${x},${y}: ${error?.message ?? String(error)}`)
      return null
    }
  }

  const getEstateImage = (estateId: string): string => `${imageBaseUrl}/v1/estates/${estateId}/map.png`
  const getParcelImage = (x: number, y: number): string => `${imageBaseUrl}/v1/parcels/${x}/${y}/map.png`

  return { getTile, getEstateImage, getParcelImage }
}
