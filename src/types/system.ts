import type {
  IConfigComponent,
  ILoggerComponent,
  IBaseComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import type { IHttpServerComponent, IFetchComponent } from '@dcl/core-commons'
import type { ISchemaValidatorComponent } from '@dcl/schema-validator-component'
import type { IPgComponent } from '../adapters/pg'
import { metricDeclarations } from '../metrics'

export type GlobalContext = {
  components: BaseComponents
}

/** Components available in every environment. */
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  fetcher: IFetchComponent
  httpServer: IHttpServerComponent<GlobalContext>
  pg: IPgComponent
  schemaValidator: ISchemaValidatorComponent<GlobalContext>
}

/** Components used at runtime (adds lifecycle-only components). */
export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
}

/** Components used in tests. */
export type TestComponents = AppComponents & {
  /** A fetch component that only hits the test server. */
  localFetch: IFetchComponent
}
