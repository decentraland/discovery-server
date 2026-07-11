import {
  createServerComponent,
  createStatusCheckComponent,
  instrumentHttpServerWithPromClientRegistry
} from '@dcl/http-server'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@dcl/metrics'
import { createFetchComponent } from '@dcl/fetch-component'
import { createSchemaValidatorComponent } from '@dcl/schema-validator-component'
import { createPgAdapter } from './adapters/pg'
import { createCategoriesRepository } from './adapters/categories-repository'
import { createSchedulesRepository } from './adapters/schedules-repository'
import { createPlacesRepository } from './adapters/places-repository'
import { createWorldsRepository } from './adapters/worlds-repository'
import { createInteractionsRepository } from './adapters/interactions-repository'
import { createProfileSettingsRepository } from './adapters/profile-settings-repository'
import { createEventsRepository } from './adapters/events-repository'
import { createAttendeesRepository } from './adapters/attendees-repository'
import { createDestinationsRepository } from './adapters/destinations-repository'
import { createContentRatingsRepository } from './adapters/content-ratings-repository'
import { createStorageComponent } from './adapters/storage'
import { createNotificationCursorsRepository } from './adapters/notification-cursors-repository'
import { createSlackNotifier } from './adapters/slack-notifier'
import { createSnsPublisher } from './adapters/sns-publisher'
import { createSnapshotClient } from './adapters/snapshot-client'
import { createCommsGatekeeperClient } from './adapters/comms-gatekeeper-client'
import { createHotScenesComponent } from './adapters/hot-scenes'
import { createSceneStatsComponent } from './adapters/scene-stats'
import { createWorldsLiveDataComponent } from './adapters/worlds-live-data'
import { createDclListsClient } from './adapters/dcl-lists-client'
import { createCatalystClient } from './adapters/catalyst-client'
import { createLandClient } from './adapters/land-client'
import { createSubgraphsClient } from './adapters/subgraphs-client'
import { createCommunitiesClient } from './adapters/communities-client'
import { createJobComponent } from '@dcl/job-component'
import { createCategoriesComponent } from './logic/categories'
import { createSchedulesComponent } from './logic/schedules'
import { createPlacesComponent } from './logic/places'
import { createWorldsComponent } from './logic/worlds'
import { createInteractionsComponent } from './logic/interactions'
import { createProfilesComponent } from './logic/profiles'
import { createRecurrenceComponent } from './logic/recurrence'
import { createEventsComponent } from './logic/events'
import { createAttendeesComponent } from './logic/attendees'
import { createLiveEventsComponent } from './logic/live-events'
import { createDestinationsComponent } from './logic/destinations'
import { createModerationComponent } from './logic/moderation'
import { createReportsComponent } from './logic/reports'
import { createSitemapComponent } from './logic/sitemap'
import { createPostersComponent } from './logic/posters'
import { createSocialComponent } from './logic/social'
import { createNotificationsComponent } from './logic/notifications'
import { createIngestionComponent } from './logic/ingestion'
import { createManifestComponent } from './logic/manifest'
import { createSqsComponent } from '@dcl/sqs-component'
import { createQueueConsumerComponent } from '@dcl/queue-consumer-component'
import { Events } from '@dcl/schemas'
import { metricDeclarations } from './metrics'
import type { AppComponents, GlobalContext } from './types'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({ path: ['.env.default', '.env'] })

  const metrics = await createMetricsComponent(metricDeclarations, { config })
  const logs = await createLogComponent({ metrics, config })

  const httpServer = await createServerComponent<GlobalContext>(
    { config, logs },
    {
      cors: {
        // These are public read/user-action APIs authenticated via signed-fetch headers
        // (not cookies), so `origin: *` is safe and is a deliberate superset of both
        // legacy services' origin whitelists — no third-party consumer can be shut out.
        origin: '*',
        methods: ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'POST', 'PUT', 'PATCH'],
        maxAge: 86400
      }
    }
  )
  const statusChecks = await createStatusCheckComponent({ server: httpServer, config })

  // Bound every outbound HTTP request so a stalled upstream can't pin handlers indefinitely.
  const httpFetchTimeoutMs = (await config.getNumber('HTTP_FETCH_TIMEOUT_MS')) ?? 30000
  const fetcher = createFetchComponent({ defaultFetcherOptions: { timeout: httpFetchTimeoutMs } })

  const schemaValidator = createSchemaValidatorComponent<GlobalContext>({ ensureJsonContentType: false })

  await instrumentHttpServerWithPromClientRegistry({
    server: httpServer,
    metrics,
    config,
    registry: metrics.registry as NonNullable<typeof metrics.registry>
  })

  const pg = await createPgAdapter({ config, logs, metrics })

  // repositories (stateless SQL owners)
  const categoriesRepository = createCategoriesRepository()
  const schedulesRepository = createSchedulesRepository()
  const placesRepository = createPlacesRepository()
  const worldsRepository = createWorldsRepository()
  const interactionsRepository = createInteractionsRepository()
  const profileSettingsRepository = createProfileSettingsRepository()
  const eventsRepository = createEventsRepository()
  const attendeesRepository = createAttendeesRepository()
  const destinationsRepository = createDestinationsRepository()
  const contentRatingsRepository = createContentRatingsRepository()
  const notificationCursorsRepository = createNotificationCursorsRepository()

  // outbound adapters (optional: no-op when unconfigured)
  const slackNotifier = await createSlackNotifier({ config, logs })
  const snsPublisher = await createSnsPublisher({ config, logs })
  const snapshotClient = await createSnapshotClient({ config, logs, fetcher })
  const commsGatekeeperClient = await createCommsGatekeeperClient({ config, logs, fetcher })
  const hotScenes = await createHotScenesComponent({ config, logs, fetcher })
  const sceneStats = await createSceneStatsComponent({ config, logs, fetcher })
  const worldsLiveData = await createWorldsLiveDataComponent({ config, logs, fetcher })
  const dclListsClient = await createDclListsClient({ config, logs, fetcher })
  const catalystClient = await createCatalystClient({ config, logs, fetcher })
  const landClient = await createLandClient({ config, logs, fetcher })
  const subgraphsClient = await createSubgraphsClient({ config, logs, fetcher })
  const communitiesClient = await createCommunitiesClient({ config, logs, fetcher })

  // storage (one adapter per bucket)
  const reportsStorage = await createStorageComponent(
    { config, logs },
    { bucketConfigKey: 'CONTENT_MODERATION_BUCKET_NAME', hostnameConfigKey: 'CONTENT_MODERATION_BUCKET_HOSTNAME' }
  )
  const postersStorage = await createStorageComponent(
    { config, logs },
    { bucketConfigKey: 'POSTER_BUCKET_NAME', hostnameConfigKey: 'POSTER_BUCKET_URL' }
  )
  const manifestStorage = await createStorageComponent({ config, logs }, { bucketConfigKey: 'PUBLIC_BUCKET' })

  // logic
  const categories = await createCategoriesComponent({ pg, categoriesRepository, dclListsClient, logs })
  const schedules = await createSchedulesComponent({ pg, schedulesRepository, logs })
  const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
  const worlds = await createWorldsComponent({ pg, worldsRepository, worldsLiveData, logs })
  const interactions = await createInteractionsComponent({ pg, interactionsRepository, snapshotClient, logs })
  const profiles = await createProfilesComponent({ pg, profileSettingsRepository, config, logs })
  const recurrence = createRecurrenceComponent()
  const events = await createEventsComponent({
    pg,
    eventsRepository,
    attendeesRepository,
    places,
    worlds,
    profiles,
    recurrence,
    communitiesClient,
    slackNotifier,
    landClient,
    config,
    logs
  })
  const attendees = await createAttendeesComponent({ pg, attendeesRepository, logs })
  const liveEvents = await createLiveEventsComponent({ pg, eventsRepository, config, logs })
  const destinations = await createDestinationsComponent({
    pg,
    destinationsRepository,
    liveEvents,
    hotScenes,
    worldsLiveData,
    sceneStats,
    logs
  })
  const moderation = await createModerationComponent({
    pg,
    placesRepository,
    worldsRepository,
    contentRatingsRepository,
    slackNotifier,
    config,
    logs
  })
  const reports = await createReportsComponent({ reportsStorage, logs })
  const sitemap = await createSitemapComponent({ config, eventsRepository, schedulesRepository, pg, logs })
  const posters = await createPostersComponent({ postersStorage, logs })
  const social = await createSocialComponent({ places, worlds, config, logs })
  const notifications = await createNotificationsComponent({
    pg,
    eventsRepository,
    attendeesRepository,
    notificationCursorsRepository,
    snsPublisher,
    communitiesClient,
    config,
    logs
  })

  // Job/consumer metric wrappers. Instrumenting here (rather than inside every
  // logic component) keeps the job_* / notifications_published / sqs_* series
  // observed without threading `metrics` through the domain layer.
  const runJob = (job: string, fn: () => Promise<unknown>) => async (): Promise<void> => {
    const timer = metrics.startTimer('job_execution_duration_seconds', { job })
    try {
      await fn()
      metrics.increment('job_execution_total', { job, result: 'success' })
    } catch (error) {
      metrics.increment('job_execution_total', { job, result: 'error' })
      throw error
    } finally {
      timer.end({ job })
    }
  }
  const runNotifyJob = (job: string, type: string, fn: () => Promise<number>) => async (): Promise<void> => {
    const timer = metrics.startTimer('job_execution_duration_seconds', { job })
    try {
      const published = await fn()
      metrics.increment('job_execution_total', { job, result: 'success' })
      if (published > 0) metrics.increment('notifications_published_total', { type }, published)
    } catch (error) {
      metrics.increment('job_execution_total', { job, result: 'error' })
      throw error
    } finally {
      timer.end({ job })
    }
  }

  // Background jobs: created only when enabled so exactly one deployment owns them.
  const backgroundJobsEnabled = (await config.getString('BACKGROUND_JOBS_ENABLED')) === 'true'
  const jobIntervalMs = (await config.getNumber('UPDATE_NEXT_START_AT_INTERVAL_MS')) ?? 60_000
  const notificationsIntervalMs = (await config.getNumber('NOTIFICATIONS_INTERVAL_MS')) ?? 60_000
  const updateNextStartAtJob = backgroundJobsEnabled
    ? createJobComponent(
        { logs },
        runJob('updateNextStartAt', () => events.updateNextStartAt()),
        jobIntervalMs,
        {
          repeat: true
        }
      )
    : undefined
  const notifyUpcomingJob = backgroundJobsEnabled
    ? createJobComponent(
        { logs },
        runNotifyJob('notifyUpcoming', 'upcoming', () => notifications.notifyUpcoming()),
        notificationsIntervalMs,
        { repeat: true }
      )
    : undefined
  const notifyStartedJob = backgroundJobsEnabled
    ? createJobComponent(
        { logs },
        runNotifyJob('notifyStarted', 'started', () => notifications.notifyStarted()),
        notificationsIntervalMs,
        { repeat: true }
      )
    : undefined
  const notifyEndedJob = backgroundJobsEnabled
    ? createJobComponent(
        { logs },
        runNotifyJob('notifyEnded', 'ended', () => notifications.notifyEnded()),
        notificationsIntervalMs,
        { repeat: true }
      )
    : undefined
  const hotScenesRefreshJob = backgroundJobsEnabled
    ? createJobComponent(
        { logs },
        runJob('hotScenesRefresh', () => hotScenes.refresh()),
        (await config.getNumber('HOT_SCENES_TTL_MS')) ?? 60_000,
        { repeat: true }
      )
    : undefined
  const worldsLiveDataRefreshJob = backgroundJobsEnabled
    ? createJobComponent(
        { logs },
        runJob('worldsLiveDataRefresh', () => worldsLiveData.refresh()),
        (await config.getNumber('WORLDS_LIVE_DATA_TTL_MS')) ?? 60_000,
        { repeat: true }
      )
    : undefined
  const poiSyncJob = backgroundJobsEnabled
    ? createJobComponent(
        { logs },
        runJob('poiSync', () => categories.syncPois()),
        (await config.getNumber('POI_SYNC_INTERVAL_MS')) ?? 24 * 60 * 60_000,
        { repeat: true }
      )
    : undefined
  const ingestion = await createIngestionComponent({
    pg,
    placesRepository,
    worldsRepository,
    subgraphsClient,
    logs
  })
  const manifest = await createManifestComponent({ pg, placesRepository, manifestStorage, config, logs })

  // Periodic (not per-deploy) so a burst of deployments doesn't trigger repeated
  // full-grid recomputes; a no-op unless PUBLIC_BUCKET is configured.
  const manifestRefreshJob = backgroundJobsEnabled
    ? createJobComponent(
        { logs },
        runJob('manifestRefresh', () => manifest.rebuild()),
        (await config.getNumber('MANIFEST_REFRESH_INTERVAL_MS')) ?? 10 * 60_000,
        { repeat: true }
      )
    : undefined

  // SQS deployment consumer: only when a queue is configured and jobs are enabled.
  const sqsQueueUrl = await config.getString('AWS_SQS_QUEUE_URL')
  let queueProcessor: Awaited<ReturnType<typeof createQueueConsumerComponent>> | undefined
  if (backgroundJobsEnabled && sqsQueueUrl) {
    const sqs = await createSqsComponent(config)
    queueProcessor = createQueueConsumerComponent({ sqs, logs })
    // The consumer deletes each message whether the handler succeeds or throws (no requeue),
    // so absorb transient failures (DB blips, subgraph hiccups) in-process with a few quick
    // retries before giving up. Ingestion is idempotent, so a retry (or an SQS redelivery) is
    // safe. A handled skip returns `{ processed: false }` and does not throw, so it never retries.
    // At least one attempt: a configured 0 must not skip the handler and drop every message.
    const retryAttempts = Math.max(1, (await config.getNumber('SQS_HANDLER_RETRY_ATTEMPTS')) ?? 3)
    const withRetry =
      (handler: (message: unknown) => Promise<unknown>) =>
      async (message: unknown): Promise<unknown> => {
        let lastError: unknown
        for (let attempt = 1; attempt <= retryAttempts; attempt++) {
          try {
            return await handler(message)
          } catch (error) {
            lastError = error
            if (attempt < retryAttempts) await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
          }
        }
        throw lastError
      }
    const withMetrics = (handler: (message: unknown) => Promise<unknown>) => async (message: unknown) => {
      try {
        await withRetry(handler)(message)
        metrics.increment('sqs_messages_processed_total', { result: 'success' })
      } catch (error) {
        metrics.increment('sqs_messages_processed_total', { result: 'error' })
        throw error
      }
    }
    queueProcessor.addMessageHandler(
      Events.Type.CATALYST_DEPLOYMENT,
      Events.SubType.CatalystDeployment.SCENE,
      withMetrics((message) => ingestion.processCatalystDeployment(message as never))
    )
    queueProcessor.addMessageHandler(
      Events.Type.WORLD,
      Events.SubType.Worlds.WORLD_SETTINGS_CHANGED,
      withMetrics((message) => ingestion.processWorldSettingsChanged(message as never))
    )
    queueProcessor.addMessageHandler(
      Events.Type.WORLD,
      Events.SubType.Worlds.WORLD_SCENES_UNDEPLOYMENT,
      withMetrics((message) => ingestion.processWorldScenesUndeployment(message as never))
    )
  }

  return {
    config,
    logs,
    metrics,
    fetcher,
    schemaValidator,
    pg,
    categoriesRepository,
    schedulesRepository,
    placesRepository,
    worldsRepository,
    interactionsRepository,
    profileSettingsRepository,
    eventsRepository,
    attendeesRepository,
    destinationsRepository,
    contentRatingsRepository,
    notificationCursorsRepository,
    slackNotifier,
    snsPublisher,
    snapshotClient,
    commsGatekeeperClient,
    dclListsClient,
    catalystClient,
    landClient,
    subgraphsClient,
    communitiesClient,
    hotScenes,
    sceneStats,
    worldsLiveData,
    reportsStorage,
    postersStorage,
    manifestStorage,
    categories,
    schedules,
    places,
    worlds,
    interactions,
    profiles,
    recurrence,
    events,
    attendees,
    liveEvents,
    destinations,
    moderation,
    reports,
    sitemap,
    posters,
    social,
    notifications,
    ingestion,
    manifest,
    // httpServer/statusChecks are placed after pg and the logic components so the
    // WKC lifecycle (reverse-insertion stop order) stops the HTTP server and drains
    // in-flight requests BEFORE the pg pool closes. Background jobs/queueProcessor
    // come last so they stop first of all.
    httpServer,
    statusChecks,
    ...(updateNextStartAtJob ? { updateNextStartAtJob } : {}),
    ...(notifyUpcomingJob ? { notifyUpcomingJob } : {}),
    ...(notifyStartedJob ? { notifyStartedJob } : {}),
    ...(notifyEndedJob ? { notifyEndedJob } : {}),
    ...(hotScenesRefreshJob ? { hotScenesRefreshJob } : {}),
    ...(worldsLiveDataRefreshJob ? { worldsLiveDataRefreshJob } : {}),
    ...(poiSyncJob ? { poiSyncJob } : {}),
    ...(manifestRefreshJob ? { manifestRefreshJob } : {}),
    ...(queueProcessor ? { queueProcessor } : {})
  }
}
