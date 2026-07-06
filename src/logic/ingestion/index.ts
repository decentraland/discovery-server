import type { CatalystDeploymentEvent } from '@dcl/schemas'
import type { AppComponents } from '../../types'
import type { UpsertWorldInput } from '../../adapters/worlds-repository'

export type IngestionResult = { processed: boolean; placeId?: string; reason?: string }

// Content-rating restrictiveness order; a move to a lower rank is a downgrade and is
// not accepted from an automated deployment (moderators lower ratings explicitly).
const RATING_RANK: Record<string, number> = { RP: 0, E: 1, T: 2, A: 3, R: 4 }

type WorldSettingsChangedMetadata = {
  worldName: string
  title?: string
  description?: string
  contentRating?: string
  skyboxTime?: number | null
  categories?: string[]
  singlePlayer?: boolean
  showInPlaces?: boolean
  thumbnailUrl?: string
  accessType?: string
}
type WorldScenesUndeploymentMetadata = {
  worldName: string
  scenes?: Array<{ entityId: string; baseParcel: string }>
}
type WorldEvent<M> = { metadata: M; timestamp?: number }

export interface IIngestionComponent {
  /** Process a Catalyst scene deployment: upsert the corresponding genesis place. */
  processCatalystDeployment(event: CatalystDeploymentEvent): Promise<IngestionResult>
  /** Process a world settings-changed event: upsert the world (owner resolved on first sight). */
  processWorldSettingsChanged(event: WorldEvent<WorldSettingsChangedMetadata>): Promise<IngestionResult>
  /** Process a world scenes-undeployment event: disable the world's undeployed places. */
  processWorldScenesUndeployment(event: WorldEvent<WorldScenesUndeploymentMetadata>): Promise<IngestionResult>
}

/**
 * Deployment ingestion. SQS messages carry the full entity/metadata, so no Catalyst
 * fetch is needed. Scene deployments upsert a genesis place; world settings-changed
 * upserts the world row (keeping title/rating/visibility fresh, resolving the on-chain
 * owner from the subgraphs on first sight); world scenes-undeployment disables the
 * affected world places.
 */
export async function createIngestionComponent(
  components: Pick<AppComponents, 'pg' | 'placesRepository' | 'worldsRepository' | 'subgraphsClient' | 'logs'>
): Promise<IIngestionComponent> {
  const { pg, placesRepository, worldsRepository, subgraphsClient, logs } = components
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

  async function processWorldSettingsChanged(
    event: WorldEvent<WorldSettingsChangedMetadata>
  ): Promise<IngestionResult> {
    const metadata = event.metadata
    const worldName = metadata?.worldName
    if (!worldName) {
      return { processed: false, reason: 'world settings-changed without a worldName' }
    }
    const id = worldName.toLowerCase()

    const existing = await worldsRepository.findByIdWithAggregates(pg, id)

    // Only accept the incoming rating if it is not a downgrade of the stored one.
    let contentRating = metadata.contentRating
    if (contentRating && existing?.content_rating) {
      const incoming = RATING_RANK[contentRating] ?? 0
      const current = RATING_RANK[existing.content_rating] ?? 0
      if (incoming < current) {
        logger.warn(`Ignoring content-rating downgrade for ${id}: ${existing.content_rating} -> ${contentRating}`)
        contentRating = undefined
      }
    }

    // Resolve the on-chain owner the first time we see a world without one.
    const owner = existing?.owner ? undefined : await subgraphsClient.getNameOwner(worldName)

    const input: UpsertWorldInput = {
      id,
      world_name: worldName,
      title: metadata.title,
      description: metadata.description,
      image: metadata.thumbnailUrl,
      content_rating: contentRating,
      categories: metadata.categories,
      show_in_places: metadata.showInPlaces,
      single_player: metadata.singlePlayer,
      skybox_time: metadata.skyboxTime ?? undefined,
      is_private: metadata.accessType ? metadata.accessType !== 'unrestricted' : undefined,
      ...(owner ? { owner } : {})
    }
    await worldsRepository.upsert(pg, input)

    logger.info(`Ingested world settings for ${id}`)
    return { processed: true }
  }

  async function processWorldScenesUndeployment(
    event: WorldEvent<WorldScenesUndeploymentMetadata>
  ): Promise<IngestionResult> {
    const worldName = event.metadata?.worldName
    const scenes = event.metadata?.scenes ?? []
    if (!worldName || !scenes.length) {
      return { processed: false, reason: 'world scenes-undeployment without worldName/scenes' }
    }
    // Guard against a late event re-disabling a place that was already re-deployed.
    const before = event.timestamp ? new Date(event.timestamp) : new Date()
    const positions = scenes.map((scene) => scene.baseParcel).filter(Boolean)
    const disabled = await placesRepository.disableByWorldIdAndPositions(pg, worldName.toLowerCase(), positions, before)

    logger.info(`Undeployed ${disabled} places for world ${worldName.toLowerCase()}`)
    return { processed: true }
  }

  return { processCatalystDeployment, processWorldSettingsChanged, processWorldScenesUndeployment }
}
