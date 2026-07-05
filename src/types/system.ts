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
import type { ICategoriesComponent } from '../logic/categories'
import type { ISchedulesComponent } from '../logic/schedules'
import type { IPlacesComponent } from '../logic/places'
import type { IWorldsComponent } from '../logic/worlds'
import type { IInteractionsComponent } from '../logic/interactions'
import type { IProfilesComponent } from '../logic/profiles'
import type { IRecurrenceComponent } from '../logic/recurrence'
import type { IEventsComponent } from '../logic/events'
import type { IAttendeesComponent } from '../logic/attendees'
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
}

export type AppComponents = BaseComponents

// components used in tests
export type TestComponents = AppComponents & {
  /** A fetch component that only hits the test server. */
  localFetch: IFetchComponent
}
