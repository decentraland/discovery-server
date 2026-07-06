import type { CatalystDeploymentEvent } from '@dcl/schemas'
import type { AppComponents } from '../../types'

export type IngestionResult = { processed: boolean; placeId?: string; reason?: string }

export interface IIngestionComponent {
  /** Process a Catalyst scene deployment: upsert the corresponding place. */
  processCatalystDeployment(event: CatalystDeploymentEvent): Promise<IngestionResult>
}

/**
 * Catalyst deployment ingestion. The SQS message carries the full entity, so no
 * Catalyst fetch is needed. Scene deployments upsert a genesis place keyed on
 * base_position. Worlds ingestion, on-chain name-owner resolution, category POI
 * overrides and the Genesis City manifest rebuild are layered in with the
 * subgraphs/worlds-content adapters.
 */
export async function createIngestionComponent(
  components: Pick<AppComponents, 'pg' | 'placesRepository' | 'logs'>
): Promise<IIngestionComponent> {
  const { pg, placesRepository, logs } = components
  const logger = logs.getLogger('ingestion')

  async function processCatalystDeployment(event: CatalystDeploymentEvent): Promise<IngestionResult> {
    const entity = event.entity
    if (!entity || entity.type !== 'scene') {
      return { processed: false, reason: `unsupported entity type: ${entity?.type ?? 'none'}` }
    }

    const metadata = (entity.metadata ?? {}) as {
      scene?: { base?: string; parcels?: string[] }
      display?: { title?: string; description?: string; navmapThumbnail?: string }
      contact?: { name?: string; email?: string }
      tags?: string[]
    }
    const base = metadata.scene?.base
    if (!base) {
      return { processed: false, reason: 'scene deployment without a base position' }
    }

    const owner = event.authChain?.[0]?.payload?.toLowerCase() ?? null

    const place = await placesRepository.upsertScene(pg, {
      base_position: base,
      positions: metadata.scene?.parcels?.length ? metadata.scene.parcels : [base],
      title: metadata.display?.title ?? null,
      description: metadata.display?.description ?? null,
      image: metadata.display?.navmapThumbnail ?? null,
      owner,
      contact_name: metadata.contact?.name ?? null,
      contact_email: metadata.contact?.email ?? null,
      categories: metadata.tags ?? [],
      sdk: null,
      deployed_at: new Date(entity.timestamp).toISOString()
    })

    logger.info(`Ingested scene deployment at ${base} -> place ${place.id}`)
    return { processed: true, placeId: place.id }
  }

  return { processCatalystDeployment }
}
