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

  return {
    config,
    logs,
    metrics,
    fetcher,
    httpServer,
    statusChecks,
    schemaValidator,
    pg
  }
}
