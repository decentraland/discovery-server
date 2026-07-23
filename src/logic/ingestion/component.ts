import type { CatalystDeploymentEvent } from '@dcl/schemas'
import type { AppComponents } from '../../types'
import type { Place } from '../../types/entities'
import type { ScenePlaceInput } from '../../adapters/places-repository'
import type { SceneEntity } from '../../adapters/catalyst-client'
import type { UpsertWorldInput } from '../../adapters/worlds-repository'
import { sanitizeDescription, sanitizeImageUrl } from '../content-sanitization'
import type {
  IIngestionComponent,
  IngestionResult,
  WorldDeploymentEventMessage,
  WorldEvent,
  WorldScenesUndeploymentMetadata,
  WorldSettingsChangedMetadata,
  WorldUndeploymentMetadata
} from './types'

// Restrictiveness order used for downgrade protection (RP/PR = pending). Automation may
// raise a rating but never lower it — moderators lower ratings explicitly.
const RATING_SCALE = ['PR', 'T', 'A', 'R']
// Placeholder/junk thumbnail hashes that must not be stored as a real image (legacy parity).
const UNWANTED_THUMBNAIL_HASHES = [
  'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
  'QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n'
]
const DEFAULT_WORLD_THUMBNAIL =
  'https://peer.decentraland.org/content/contents/bafkreidj26s7aenyxfthfdibnqonzqm5ptc4iamml744gmcyuokewkr76y'
// Forbidden as creator-supplied tags (only moderators/sync assign these).
const FORBIDDEN_CATEGORY_TAGS = ['poi', 'featured']
const MAX_CREATOR_CATEGORIES = 3

// Collapse newlines/control chars so an untrusted SQS field can't forge extra log lines.
const oneLine = (value: string): string => value.replace(/[\r\n\t]+/g, ' ')

const ratingIndex = (rating: string): number =>
  RATING_SCALE.indexOf(rating.toUpperCase() === 'RP' ? 'PR' : rating.toUpperCase())

/** Normalize a scene's declared rating: map legacy E→T / M→A, validate, default to PR. */
function normalizeRating(raw?: string): string {
  const value = (raw ?? '').toUpperCase()
  if (value === 'E') return 'T'
  if (value === 'M') return 'A'
  return RATING_SCALE.includes(value) ? value : 'PR'
}

/** Derive the stored rating: normalized incoming, unless it would downgrade the existing one. */
function deriveContentRating(raw: string | undefined, existing: string | null): string {
  const incoming = normalizeRating(raw)
  if (!existing) return incoming
  return ratingIndex(existing) > ratingIndex(incoming) ? existing : incoming
}

type SceneMetadata = {
  scene?: { base?: string; parcels?: string[] }
  display?: { title?: string; description?: string; navmapThumbnail?: string }
  contact?: { name?: string; email?: string }
  policy?: { contentRating?: string }
  worldConfiguration?: { name?: string; dclName?: string; placesConfig?: { optOut?: boolean } }
  owner?: string
  creator?: string
  runtimeVersion?: string
  tags?: string[]
}

/**
 * Deployment ingestion. Genesis scenes (and world scenes carrying full metadata) arrive as
 * Catalyst deployment events with the whole entity; world scene deployments arrive with only
 * an entityId and are fetched. Each deployment derives the place's title/image/rating/sdk/
 * creator/categories the same way the legacy CheckScenes task did — writing a content-rating
 * audit row on change, maintaining the place_categories join, disabling superseded overlapping
 * places, guarding against stale (out-of-order) redeliveries, and announcing to Slack.
 */
export async function createIngestionComponent(
  components: Pick<
    AppComponents,
    | 'pg'
    | 'placesRepository'
    | 'worldsRepository'
    | 'categoriesRepository'
    | 'contentRatingsRepository'
    | 'subgraphsClient'
    | 'catalystClient'
    | 'landClient'
    | 'slackNotifier'
    | 'config'
    | 'logs'
  >
): Promise<IIngestionComponent> {
  const {
    pg,
    placesRepository,
    worldsRepository,
    categoriesRepository,
    contentRatingsRepository,
    subgraphsClient,
    catalystClient,
    landClient,
    slackNotifier,
    config,
    logs
  } = components
  const logger = logs.getLogger('ingestion')

  const contentServerUrl = (
    (await config.getString('CONTENT_SERVER_URL')) ?? 'https://peer.decentraland.org/content'
  ).replace(/\/+$/, '')
  const placesChannel = (await config.getString('SLACK_PLACES_CHANNEL')) ?? undefined
  const alert = (text: string) => {
    void slackNotifier.notify(text, placesChannel)
  }

  /** Resolve the served image: a relative navmapThumbnail → content URL (filtered), else a fallback. */
  function resolveImage(
    metadata: SceneMetadata,
    content: SceneEntity['content'],
    base: string,
    isWorld: boolean
  ): string | null {
    let thumbnail = metadata.display?.navmapThumbnail || null
    if (thumbnail && !thumbnail.startsWith('https://')) {
      const file = content?.find((entry) => entry.file === thumbnail)
      thumbnail =
        !file || UNWANTED_THUMBNAIL_HASHES.includes(file.hash) ? null : `${contentServerUrl}/contents/${file.hash}`
    } else if (thumbnail) {
      // A verbatim `https://` navmapThumbnail is attacker-controlled and stored as-is; keep it
      // only if it is a safe http(s) URL so it can't inject markup into API responses / OG HTML.
      thumbnail = sanitizeImageUrl(thumbnail)
    }
    if (!thumbnail && isWorld) return DEFAULT_WORLD_THUMBNAIL
    if (!thumbnail) {
      const [x, y] = base.split(',').map((n) => Number(n))
      return Number.isFinite(x) && Number.isFinite(y) ? landClient.getParcelImage(x, y) : null
    }
    return thumbnail
  }

  /** Keep only known active categories a creator may set: cap 3, drop POI/FEATURED, then re-add any the place already had. */
  async function resolveCategories(placeId: string | null, tags: string[]): Promise<string[]> {
    if (!tags.length) return []
    const active = new Set(await categoriesRepository.findActivePlaceCategories(pg))
    const valid: string[] = []
    for (const tag of tags) {
      const name = tag.toLowerCase()
      if (FORBIDDEN_CATEGORY_TAGS.includes(name) || !active.has(name) || valid.includes(name)) continue
      valid.push(name)
      if (valid.length === MAX_CREATOR_CATEGORIES) break
    }
    if (!valid.length) return []
    // Preserve moderator-managed POI/FEATURED assignments across a redeploy.
    if (placeId) {
      const existing = await placesRepository.findByIdWithAggregates(pg, placeId)
      for (const tag of FORBIDDEN_CATEGORY_TAGS) {
        if (existing?.categories?.includes(tag)) valid.push(tag)
      }
    }
    return valid
  }

  /** Build the place row for a scene deployment (shared by genesis + world). */
  function deriveScene(
    entity: SceneEntity,
    existing: Place | null,
    options: { worldId: string | null; worldName: string | null; optOut: boolean }
  ): ScenePlaceInput {
    const metadata = (entity.metadata ?? {}) as SceneMetadata
    const positions = [...(entity.pointers ?? [])].sort()
    const base = metadata.scene?.base || positions[0]
    const isWorld = !!options.worldId
    const rawTitle = metadata.display?.title
    let contactName = metadata.contact?.name || null
    if (contactName && contactName.trim() === 'author-name') contactName = null

    return {
      base_position: base,
      positions,
      title: rawTitle ? rawTitle.slice(0, 50) : 'Untitled',
      // Strip client-rendered TMP markup (e.g. `<link="decentraland://…">`) from the
      // creator-authored description before storing, so it can't reach Application.OpenURL.
      description: sanitizeDescription(metadata.display?.description),
      image: resolveImage(metadata, entity.content, base, isWorld),
      owner: metadata.owner?.toLowerCase() || null,
      creator_address: metadata.creator?.toLowerCase() || null,
      contact_name: contactName,
      contact_email: metadata.contact?.email || null,
      content_rating: deriveContentRating(metadata.policy?.contentRating, existing?.content_rating ?? null),
      categories: [],
      sdk: metadata.runtimeVersion || null,
      deployed_at: new Date(entity.timestamp ?? Date.now()).toISOString(),
      world: isWorld,
      world_id: options.worldId,
      world_name: options.worldName,
      disabled: options.optOut,
      disabled_reason: options.optOut ? 'opt_out' : null
    }
  }

  /**
   * Persist a derived scene: skip if an overlapping place has a newer deployment (stale guard);
   * update the single overlapping place or insert a new one; disable the rest; write a rating
   * audit row on change; sync the place_categories; announce to Slack. Runs in one transaction.
   */
  async function persistScene(
    entity: SceneEntity,
    overlapping: Place[],
    options: { worldId: string | null; worldName: string | null; optOut: boolean }
  ): Promise<IngestionResult> {
    const metadata = (entity.metadata ?? {}) as SceneMetadata
    const positions = [...(entity.pointers ?? [])].sort()
    const base = metadata.scene?.base || positions[0]
    if (!base) return { processed: false, reason: 'scene deployment without a base position' }

    const deployedAt = new Date(entity.timestamp ?? Date.now())
    if (Number.isNaN(deployedAt.getTime())) {
      return { processed: false, reason: `scene deployment with an invalid timestamp: ${entity.timestamp}` }
    }
    // Stale-deployment guard: an out-of-order/older redelivery must not clobber newer data.
    // Strictly newer only (legacy findNewDeployedPlace) so a same-timestamp redeploy still applies.
    if (overlapping.some((place) => new Date(place.deployed_at).getTime() > deployedAt.getTime())) {
      return { processed: false, reason: 'a newer deployment already exists' }
    }

    // Identity: the overlapping place sharing the base position is "the same scene"; the rest are superseded.
    const same = overlapping.find((place) => place.base_position === base) ?? null
    const toDisable = overlapping.filter((place) => place.id !== same?.id)
    const scene = deriveScene(entity, same, options)
    const validCategories = await resolveCategories(same?.id ?? null, metadata.tags ?? [])

    const result = await pg.withTransaction(async (tx) => {
      const place = same
        ? await placesRepository.updateScene(tx, same.id, scene)
        : await placesRepository.insertScene(tx, scene)

      // Content-rating audit trail (ingest actor is the content creator, not a moderator).
      const previousRating = same?.content_rating ?? null
      if (previousRating !== place.content_rating) {
        await contentRatingsRepository.record(tx, {
          entityId: place.id,
          originalRating: previousRating,
          updateRating: place.content_rating,
          moderator: 'content-creator',
          comment: null
        })
      }
      await categoriesRepository.setPlaceCategories(tx, place.id, validCategories)
      const disabled = toDisable.length
        ? await placesRepository.disablePlaces(
            tx,
            toDisable.map((p) => p.id),
            'undeployment'
          )
        : 0
      return { place, created: !same, disabled }
    })

    if (result.created) alert(`:sparkles: New place: ${oneLine(result.place.title ?? 'Untitled')} at ${oneLine(base)}`)
    else alert(`:pencil2: Updated place: ${oneLine(result.place.title ?? 'Untitled')} at ${oneLine(base)}`)
    if (result.disabled) alert(`:no_entry: Disabled ${result.disabled} superseded place(s) at ${oneLine(base)}`)

    logger.info(
      `Ingested ${options.worldId ? 'world' : 'genesis'} scene at ${oneLine(base)} -> place ${result.place.id}`
    )
    return { processed: true, placeId: result.place.id }
  }

  async function processGenesisScene(entity: SceneEntity): Promise<IngestionResult> {
    const overlapping = await placesRepository.findEnabledByPositions(pg, entity.pointers ?? [])
    return persistScene(entity, overlapping, { worldId: null, worldName: null, optOut: false })
  }

  async function processWorldScene(entity: SceneEntity): Promise<IngestionResult> {
    const metadata = (entity.metadata ?? {}) as SceneMetadata
    const worldName = metadata.worldConfiguration?.name || metadata.worldConfiguration?.dclName
    if (!worldName) return { processed: false, reason: 'world scene deployment without a worldConfiguration name' }
    const worldId = worldName.toLowerCase()
    const optOut = !!metadata.worldConfiguration?.placesConfig?.optOut

    // The world row's owner is always the on-chain name owner; refresh it every deployment.
    const nameOwner = await subgraphsClient.getNameOwner(worldName)
    const worldInput: UpsertWorldInput = {
      id: worldId,
      world_name: worldName,
      title: metadata.display?.title?.slice(0, 50),
      // Worlds render in the same TMP client UI, so the same markup rules apply.
      description: sanitizeDescription(metadata.display?.description) ?? undefined,
      content_rating: normalizeRating(metadata.policy?.contentRating),
      categories: metadata.tags,
      show_in_places: !optOut,
      ...(nameOwner ? { owner: nameOwner } : {})
    }
    await worldsRepository.upsert(pg, worldInput)

    const overlapping = await placesRepository.findActiveByWorldIdAndPositions(pg, worldId, entity.pointers ?? [])
    return persistScene(entity, overlapping, { worldId, worldName, optOut })
  }

  async function processCatalystDeployment(event: CatalystDeploymentEvent): Promise<IngestionResult> {
    const entity = event.entity as unknown as SceneEntity
    if (!entity || entity.type !== 'scene') {
      return { processed: false, reason: `unsupported entity type: ${entity?.type ?? 'none'}` }
    }
    const metadata = (entity.metadata ?? {}) as SceneMetadata
    // A world scene may arrive through the Catalyst deployment channel too: branch on worldConfiguration.
    return metadata.worldConfiguration ? processWorldScene(entity) : processGenesisScene(entity)
  }

  async function processWorldDeployment(event: WorldDeploymentEventMessage): Promise<IngestionResult> {
    const entityId = event.entity?.entityId
    const server = event.contentServerUrls?.[0]
    if (!entityId || !server) return { processed: false, reason: 'world deployment without entityId/contentServerUrls' }
    const entity = await catalystClient.getEntityById(server, entityId)
    if (!entity || entity.type !== 'scene') {
      return { processed: false, reason: `world deployment entity not fetchable: ${oneLine(entityId)}` }
    }
    return processWorldScene(entity)
  }

  async function processWorldSettingsChanged(
    event: WorldEvent<WorldSettingsChangedMetadata>
  ): Promise<IngestionResult> {
    const metadata = event.metadata
    const worldName = metadata?.worldName
    if (!worldName) return { processed: false, reason: 'world settings-changed without a worldName' }
    const id = worldName.toLowerCase()

    const existing = await worldsRepository.findByIdWithAggregates(pg, id)
    // Normalize (E→T/M→A) then reject a downgrade of the stored rating (moderators lower explicitly).
    let contentRating: string | undefined
    if (metadata.contentRating !== undefined) {
      contentRating = normalizeRating(metadata.contentRating)
      if (existing?.content_rating && ratingIndex(existing.content_rating) > ratingIndex(contentRating)) {
        logger.warn(
          `Ignoring content-rating downgrade for ${oneLine(id)}: ${existing.content_rating} -> ${contentRating}`
        )
        contentRating = undefined
      }
    }

    const owner = await subgraphsClient.getNameOwner(worldName)
    const input: UpsertWorldInput = {
      id,
      world_name: worldName,
      title: metadata.title,
      // Preserve upsert's "omitted means do not update" contract: only sanitize (and, for an
      // unsafe value, clear) when the field was actually provided, so a settings event that
      // omits it never wipes the stored value.
      description: metadata.description === undefined ? undefined : sanitizeDescription(metadata.description),
      image: metadata.thumbnailUrl === undefined ? undefined : sanitizeImageUrl(metadata.thumbnailUrl),
      content_rating: contentRating,
      categories: metadata.categories,
      show_in_places: metadata.showInPlaces,
      single_player: metadata.singlePlayer,
      skybox_time: metadata.skyboxTime ?? undefined,
      is_private: metadata.accessType ? metadata.accessType !== 'unrestricted' : undefined,
      ...(owner ? { owner } : {})
    }
    await worldsRepository.upsert(pg, input)

    logger.info(`Ingested world settings for ${oneLine(id)}`)
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
    const before = event.timestamp ? new Date(event.timestamp) : new Date()
    const positions = scenes.map((scene) => scene.baseParcel).filter(Boolean)
    const disabled = await placesRepository.disableByWorldIdAndPositions(pg, worldName.toLowerCase(), positions, before)

    logger.info(`Undeployed ${disabled} scenes for world ${oneLine(worldName.toLowerCase())}`)
    return { processed: true }
  }

  async function processWorldUndeployment(event: WorldEvent<WorldUndeploymentMetadata>): Promise<IngestionResult> {
    const worldName = event.metadata?.worldName
    if (!worldName) return { processed: false, reason: 'world undeployment without a worldName' }
    const before = event.timestamp ? new Date(event.timestamp) : new Date()
    const disabled = await placesRepository.disableByWorldId(pg, worldName.toLowerCase(), before)
    if (disabled) alert(`:no_entry: World undeployed: ${disabled} place(s) for ${oneLine(worldName.toLowerCase())}`)

    logger.info(`Undeployed world ${oneLine(worldName.toLowerCase())}: disabled ${disabled} places`)
    return { processed: true }
  }

  return {
    processCatalystDeployment,
    processWorldDeployment,
    processWorldSettingsChanged,
    processWorldScenesUndeployment,
    processWorldUndeployment
  }
}
