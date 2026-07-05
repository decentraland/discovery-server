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
import type { ICategoriesComponent } from '../logic/categories'
import type { ISchedulesComponent } from '../logic/schedules'
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

  // logic
  categories: ICategoriesComponent
  schedules: ISchedulesComponent
}

export type AppComponents = BaseComponents

// components used in tests
export type TestComponents = AppComponents & {
  /** A fetch component that only hits the test server. */
  localFetch: IFetchComponent
}
