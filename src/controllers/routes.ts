import { Router } from '@well-known-components/http-server'
import { pingHandler } from './handlers/ping-handler'
import { statusHandler } from './handlers/status-handler'
import type { GlobalContext } from '../types'

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(_globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  router.get('/ping', pingHandler)

  router.get('/status', statusHandler)

  return router
}
