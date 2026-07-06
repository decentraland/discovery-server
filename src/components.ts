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
import { createCategoriesComponent } from './logic/categories'
import { createSchedulesComponent } from './logic/schedules'
import { createPlacesComponent } from './logic/places'
import { createWorldsComponent } from './logic/worlds'
import { createInteractionsComponent } from './logic/interactions'
import { createProfilesComponent } from './logic/profiles'
import { createRecurrenceComponent } from './logic/recurrence'
import { createEventsComponent } from './logic/events'
import { createAttendeesComponent } from './logic/attendees'
import { createDestinationsComponent } from './logic/destinations'
import { createModerationComponent } from './logic/moderation'
import { createReportsComponent } from './logic/reports'
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

  // storage (one adapter per bucket)
  const reportsStorage = await createStorageComponent(
    { config, logs },
    { bucketConfigKey: 'CONTENT_MODERATION_BUCKET_NAME', hostnameConfigKey: 'CONTENT_MODERATION_BUCKET_HOSTNAME' }
  )
  const postersStorage = await createStorageComponent(
    { config, logs },
    { bucketConfigKey: 'POSTER_BUCKET_NAME', hostnameConfigKey: 'POSTER_BUCKET_URL' }
  )

  // logic
  const categories = await createCategoriesComponent({ pg, categoriesRepository, logs })
  const schedules = await createSchedulesComponent({ pg, schedulesRepository, logs })
  const places = await createPlacesComponent({ pg, placesRepository, logs })
  const worlds = await createWorldsComponent({ pg, worldsRepository, logs })
  const interactions = await createInteractionsComponent({ pg, interactionsRepository, logs })
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
    logs
  })
  const attendees = await createAttendeesComponent({ pg, attendeesRepository, logs })
  const destinations = await createDestinationsComponent({ pg, destinationsRepository, eventsRepository, logs })
  const moderation = await createModerationComponent({
    pg,
    placesRepository,
    worldsRepository,
    contentRatingsRepository,
    logs
  })
  const reports = await createReportsComponent({ reportsStorage, logs })

  return {
    config,
    logs,
    metrics,
    fetcher,
    httpServer,
    statusChecks,
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
    reportsStorage,
    postersStorage,
    categories,
    schedules,
    places,
    worlds,
    interactions,
    profiles,
    recurrence,
    events,
    attendees,
    destinations,
    moderation,
    reports
  }
}
