import { Router } from '@dcl/http-server'
import type { GlobalContext } from '../types'
import { errorHandler } from './middlewares/error-handler'
import { pingHandler } from './handlers/ping-handler'
import { statusHandler } from './handlers/status-handler'
import { getCategoriesHandler } from './handlers/get-categories-handler'
import { getEventCategoriesHandler } from './handlers/get-event-categories-handler'
import { getScheduleByIdHandler, getSchedulesHandler } from './handlers/get-schedules-handler'
import {
  getPlaceHandler,
  getPlaceListByIdHandler,
  getPlaceListHandler,
  getPlaceStatusListHandler
} from './handlers/get-places-handler'
import { getWorldHandler, getWorldListHandler, getWorldNamesHandler } from './handlers/get-worlds-handler'

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

  // places (optional-signed reads; auth wiring lands with the signed-fetch middleware)
  router.get('/api/places', getPlaceListHandler)
  router.post('/api/places', getPlaceListByIdHandler)
  router.post('/api/places/status', getPlaceStatusListHandler)
  router.get('/api/places/:place_id', getPlaceHandler)

  // worlds (optional-signed reads)
  router.get('/api/worlds', getWorldListHandler)
  router.get('/api/world_names', getWorldNamesHandler)
  router.get('/api/worlds/:world_id', getWorldHandler)

  return router
}
