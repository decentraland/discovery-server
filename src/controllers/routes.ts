import { Router } from '@dcl/http-server'
import type { GlobalContext } from '../types'
import { errorHandler } from './middlewares/error-handler'
import { pingHandler } from './handlers/ping-handler'
import { statusHandler } from './handlers/status-handler'
import { getCategoriesHandler } from './handlers/get-categories-handler'
import { getEventCategoriesHandler } from './handlers/get-event-categories-handler'
import { getScheduleByIdHandler, getSchedulesHandler } from './handlers/get-schedules-handler'

/**
 * Assembles the HTTP router. The central error handler is registered first so
 * it wraps every downstream handler. Legacy `/api/*` + `/places/*` route groups
 * and the new `/v1/*` discovery layer are added in later phases.
 */
export async function setupRouter(_globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  router.use(errorHandler)

  router.get('/ping', pingHandler)
  router.get('/api/status', statusHandler)

  // categories (public reads) — legacy places + events surfaces
  router.get('/api/categories', getCategoriesHandler)
  router.get('/api/events/categories', getEventCategoriesHandler)

  // schedules (public reads)
  router.get('/api/schedules', getSchedulesHandler)
  router.get('/api/schedules/:schedule_id', getScheduleByIdHandler)

  return router
}
