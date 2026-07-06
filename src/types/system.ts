import type {
  IConfigComponent,
  ILoggerComponent,
  IBaseComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import type { IHttpServerComponent, IFetchComponent } from '@dcl/core-commons'
import type { ISchemaValidatorComponent } from '@dcl/schema-validator-component'
import type { IPgComponent } from '../adapters/pg'
import type { ICategoriesRepository } from '../adapters/categories-repository'
import type { ISchedulesRepository } from '../adapters/schedules-repository'
import type { IPlacesRepository } from '../adapters/places-repository'
import type { IWorldsRepository } from '../adapters/worlds-repository'
import type { IInteractionsRepository } from '../adapters/interactions-repository'
import type { IProfileSettingsRepository } from '../adapters/profile-settings-repository'
import type { IEventsRepository } from '../adapters/events-repository'
import type { IAttendeesRepository } from '../adapters/attendees-repository'
import type { IDestinationsRepository } from '../adapters/destinations-repository'
import type { IContentRatingsRepository } from '../adapters/content-ratings-repository'
import type { IStorageComponent } from '../adapters/storage'
import type { INotificationCursorsRepository } from '../adapters/notification-cursors-repository'
import type { ISlackNotifier } from '../adapters/slack-notifier'
import type { ISnsPublisher } from '../adapters/sns-publisher'
import type { ISnapshotClient } from '../adapters/snapshot-client'
import type { ICommsGatekeeperClient } from '../adapters/comms-gatekeeper-client'
import type { IHotScenesComponent } from '../adapters/hot-scenes'
import type { ISceneStatsComponent } from '../adapters/scene-stats'
import type { IWorldsLiveDataComponent } from '../adapters/worlds-live-data'
import type { IDclListsClient } from '../adapters/dcl-lists-client'
import type { ICatalystClient } from '../adapters/catalyst-client'
import type { ICommunitiesClient } from '../adapters/communities-client'
import type { IJobComponent } from '@dcl/job-component'
import type { ICategoriesComponent } from '../logic/categories'
import type { ISchedulesComponent } from '../logic/schedules'
import type { IPlacesComponent } from '../logic/places'
import type { IWorldsComponent } from '../logic/worlds'
import type { IInteractionsComponent } from '../logic/interactions'
import type { IProfilesComponent } from '../logic/profiles'
import type { IRecurrenceComponent } from '../logic/recurrence'
import type { IEventsComponent } from '../logic/events'
import type { IAttendeesComponent } from '../logic/attendees'
import type { IDestinationsComponent } from '../logic/destinations'
import type { IModerationComponent } from '../logic/moderation'
import type { IReportsComponent } from '../logic/reports'
import type { ISitemapComponent } from '../logic/sitemap'
import type { IPostersComponent } from '../logic/posters'
import type { ISocialComponent } from '../logic/social'
import type { INotificationsComponent } from '../logic/notifications'
import type { IIngestionComponent } from '../logic/ingestion'
import type { IQueueConsumerComponent } from '@dcl/queue-consumer-component'
import { metricDeclarations } from '../metrics'

export type GlobalContext = {
  components: BaseComponents
}

export type MetricsDeclaration = keyof typeof metricDeclarations

/**
 * The full component set. Handlers pick the components they need from
 * `AppComponents`; the router context exposes `BaseComponents`, so every
 * component a handler can pick lives here.
 */
export type BaseComponents = {
  // platform
  config: IConfigComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<MetricsDeclaration>
  fetcher: IFetchComponent
  httpServer: IHttpServerComponent<GlobalContext>
  statusChecks: IBaseComponent
  pg: IPgComponent
  schemaValidator: ISchemaValidatorComponent<GlobalContext>

  // repositories
  categoriesRepository: ICategoriesRepository
  schedulesRepository: ISchedulesRepository
  placesRepository: IPlacesRepository
  worldsRepository: IWorldsRepository
  interactionsRepository: IInteractionsRepository
  profileSettingsRepository: IProfileSettingsRepository
  eventsRepository: IEventsRepository
  attendeesRepository: IAttendeesRepository
  destinationsRepository: IDestinationsRepository
  contentRatingsRepository: IContentRatingsRepository
  notificationCursorsRepository: INotificationCursorsRepository

  // storage (one per bucket)
  reportsStorage: IStorageComponent
  postersStorage: IStorageComponent

  // outbound
  slackNotifier: ISlackNotifier
  snsPublisher: ISnsPublisher

  // external clients
  snapshotClient: ISnapshotClient
  commsGatekeeperClient: ICommsGatekeeperClient
  dclListsClient: IDclListsClient
  catalystClient: ICatalystClient
  communitiesClient: ICommunitiesClient

  // cached live data
  hotScenes: IHotScenesComponent
  sceneStats: ISceneStatsComponent
  worldsLiveData: IWorldsLiveDataComponent

  // logic
  categories: ICategoriesComponent
  schedules: ISchedulesComponent
  places: IPlacesComponent
  worlds: IWorldsComponent
  interactions: IInteractionsComponent
  profiles: IProfilesComponent
  recurrence: IRecurrenceComponent
  events: IEventsComponent
  attendees: IAttendeesComponent
  destinations: IDestinationsComponent
  moderation: IModerationComponent
  reports: IReportsComponent
  sitemap: ISitemapComponent
  posters: IPostersComponent
  social: ISocialComponent
  notifications: INotificationsComponent
  ingestion: IIngestionComponent

  // background jobs (present only when BACKGROUND_JOBS_ENABLED)
  updateNextStartAtJob?: IJobComponent
  notifyUpcomingJob?: IJobComponent
  notifyStartedJob?: IJobComponent
  notifyEndedJob?: IJobComponent
  hotScenesRefreshJob?: IJobComponent
  worldsLiveDataRefreshJob?: IJobComponent
  poiSyncJob?: IJobComponent
  // SQS deployment consumer (present only when AWS_SQS_QUEUE_URL is configured)
  queueProcessor?: IQueueConsumerComponent
}

export type AppComponents = BaseComponents

// components used in tests
export type TestComponents = AppComponents & {
  /** A fetch component that only hits the test server. */
  localFetch: IFetchComponent
}
