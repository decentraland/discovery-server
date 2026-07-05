import { Router } from '@dcl/http-server'
import type { GlobalContext } from '../types'
import { errorHandler } from './middlewares/error-handler'
import { createSignedFetchMiddleware } from './middlewares/signed-fetch'
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
import { updateFavoritesHandler, updateLikesHandler } from './handlers/update-interactions-handler'

/**
 * Assembles the HTTP router. The central error handler is registered first so it
 * wraps every downstream handler. Reads that surface per-user state use optional
 * signed fetch; writes require it. The new `/v1/*` discovery layer lands later.
 */
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()
  const signedFetch = createSignedFetchMiddleware(globalContext.components.fetcher)

  router.use(errorHandler)

  router.get('/ping', pingHandler)
  router.get('/api/status', statusHandler)

  // categories (public reads) — legacy places + events surfaces
  router.get('/api/categories', getCategoriesHandler)
  router.get('/api/events/categories', getEventCategoriesHandler)

  // schedules (public reads)
  router.get('/api/schedules', getSchedulesHandler)
  router.get('/api/schedules/:schedule_id', getScheduleByIdHandler)

  // places (optional-signed reads, signed writes)
  router.get('/api/places', signedFetch({ optional: true }), getPlaceListHandler)
  router.post('/api/places', signedFetch({ optional: true }), getPlaceListByIdHandler)
  router.post('/api/places/status', getPlaceStatusListHandler)
  router.get('/api/places/:place_id', signedFetch({ optional: true }), getPlaceHandler)
  router.patch('/api/places/:entity_id/likes', signedFetch(), updateLikesHandler)
  router.patch('/api/places/:entity_id/favorites', signedFetch(), updateFavoritesHandler)

  // worlds (optional-signed reads, signed writes)
  router.get('/api/worlds', signedFetch({ optional: true }), getWorldListHandler)
  router.get('/api/world_names', getWorldNamesHandler)
  router.get('/api/worlds/:world_id', signedFetch({ optional: true }), getWorldHandler)
  router.patch('/api/worlds/:world_id/likes', signedFetch(), updateLikesHandler)
  router.patch('/api/worlds/:world_id/favorites', signedFetch(), updateFavoritesHandler)

  return router
}
