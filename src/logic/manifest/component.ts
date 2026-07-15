import type { AppComponents } from '../../types'
import type { IManifestComponent, ManifestResult } from './types'

/**
 * Genesis City manifest publisher (ported from the legacy places service). The
 * manifest lists road, occupied and empty parcels for the map; `empty` is the full
 * coordinate set minus roads and occupied. The large coordinate fixtures are loaded
 * lazily so they only cost memory when a rebuild actually runs.
 */
export async function createManifestComponent(
  components: Pick<AppComponents, 'pg' | 'placesRepository' | 'manifestStorage' | 'config' | 'logs'>
): Promise<IManifestComponent> {
  const { pg, placesRepository, manifestStorage, config } = components
  const logger = components.logs.getLogger('manifest')

  const enabled = !!(await config.getString('PUBLIC_BUCKET'))
  let inFlight = false

  async function rebuild(): Promise<ManifestResult> {
    if (!enabled) return { published: false, occupied: 0, empty: 0 }
    // Guard against overlapping rebuilds (the job and any manual trigger).
    if (inFlight) return { published: false, occupied: 0, empty: 0 }
    inFlight = true
    try {
      const [{ default: allCoordinates }, { default: roadCoordinates }] = await Promise.all([
        import('../../data/all-coordinates.json'),
        import('../../data/road-coordinates.json')
      ])
      const occupied = await placesRepository.listOccupiedPositions(pg)

      const roadSet = new Set(roadCoordinates as string[])
      const occupiedSet = new Set(occupied)
      const emptySet = new Set(allCoordinates as string[])
      roadSet.forEach((coordinate) => emptySet.delete(coordinate))
      occupiedSet.forEach((coordinate) => emptySet.delete(coordinate))

      const manifest = {
        roads: Array.from(roadSet),
        occupied: Array.from(occupiedSet),
        empty: Array.from(emptySet)
      }
      await manifestStorage.uploadObject('WorldManifest.json', JSON.stringify(manifest), 'application/json')
      logger.info(`Published Genesis City manifest: ${occupiedSet.size} occupied, ${emptySet.size} empty`)
      return { published: true, occupied: occupiedSet.size, empty: emptySet.size }
    } finally {
      inFlight = false
    }
  }

  return { rebuild }
}
