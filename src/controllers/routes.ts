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
import { createRequirePermission } from './middlewares/authorization'
import { ProfilePermission } from '../types/entities'
import {
  getMyProfileSettingsHandler,
  getProfileSettingsHandler,
  getProfileSettingsListHandler,
  updateProfileSettingsHandler
} from './handlers/profile-settings-handler'
import {
  createEventHandler,
  deleteEventHandler,
  getAttendingEventsHandler,
  getEventHandler,
  getEventListHandler,
  updateEventHandler
} from './handlers/events-handler'
import { createAttendeeHandler, deleteAttendeeHandler, getAttendeesHandler } from './handlers/attendees-handler'
import { getDestinationsByIdHandler, getDestinationsListHandler } from './handlers/destinations-handler'
import { createReportHandler } from './handlers/report-handler'
import {
  getEventsSitemapHandler,
  getSchedulesSitemapHandler,
  getSitemapIndexHandler,
  getStaticSitemapHandler
} from './handlers/sitemap-handler'
import { createPosterHandler, createVerticalPosterHandler } from './handlers/posters-handler'
import { createAnyBearerMiddleware } from './middlewares/bearer-token'
import {
  updatePlaceDisabledHandler,
  updatePlaceHighlightHandler,
  updatePlaceRankingHandler,
  updatePlaceRatingHandler,
  updateWorldHighlightHandler,
  updateWorldRankingHandler,
  updateWorldRatingHandler
} from './handlers/moderation-handler'

/**
 * Assembles the HTTP router. The central error handler is registered first so it
 * wraps every downstream handler. Reads that surface per-user state use optional
 * signed fetch; writes require it. The new `/v1/*` discovery layer lands later.
 */
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()
  const { components } = globalContext
  const signedFetch = createSignedFetchMiddleware(components.fetcher)
  const requirePermission = createRequirePermission(components.profiles)
  const dataTeamToken = await components.config.getString('DATA_TEAM_AUTH_TOKEN')
  // Data-team ranking routes are only mounted when their bearer token is configured.
  const withDataTeamBearer = dataTeamToken ? createAnyBearerMiddleware([dataTeamToken]) : undefined

  router.use(errorHandler)

  router.get('/ping', pingHandler)
  router.get('/api/status', statusHandler)

  // categories (public reads) — legacy places + events surfaces
  router.get('/api/categories', getCategoriesHandler)
  router.get('/api/events/categories', getEventCategoriesHandler)

  // schedules (public reads)
  router.get('/api/schedules', getSchedulesHandler)
  router.get('/api/schedules/:schedule_id', getScheduleByIdHandler)

  // events — static/collection routes registered before the :event_id matcher
  router.get('/api/events', signedFetch({ optional: true }), getEventListHandler)
  router.post('/api/events', signedFetch(), createEventHandler)
  router.get('/api/events/attending', signedFetch(), getAttendingEventsHandler)
  router.get('/api/events/:event_id', signedFetch({ optional: true }), getEventHandler)
  router.patch('/api/events/:event_id', signedFetch(), updateEventHandler)
  router.delete('/api/events/:event_id', signedFetch(), deleteEventHandler)
  router.get('/api/events/:event_id/attendees', getAttendeesHandler)
  router.post('/api/events/:event_id/attendees', signedFetch(), createAttendeeHandler)
  router.delete('/api/events/:event_id/attendees', signedFetch(), deleteAttendeeHandler)

  // places (optional-signed reads, signed writes)
  router.get('/api/places', signedFetch({ optional: true }), getPlaceListHandler)
  router.post('/api/places', signedFetch({ optional: true }), getPlaceListByIdHandler)
  router.post('/api/places/status', getPlaceStatusListHandler)
  router.get('/api/places/:place_id', signedFetch({ optional: true }), getPlaceHandler)
  router.patch('/api/places/:entity_id/likes', signedFetch(), updateLikesHandler)
  router.patch('/api/places/:entity_id/favorites', signedFetch(), updateFavoritesHandler)
  // places moderation (signed admin); ranking is data-team bearer
  router.put('/api/places/:place_id/rating', signedFetch(), requirePermission(), updatePlaceRatingHandler)
  router.put('/api/places/:place_id/highlight', signedFetch(), requirePermission(), updatePlaceHighlightHandler)
  router.put('/api/places/:place_id/disable', signedFetch(), requirePermission(), updatePlaceDisabledHandler)
  if (withDataTeamBearer) {
    router.put('/api/places/:place_id/ranking', withDataTeamBearer, updatePlaceRankingHandler)
  }

  // content-moderation report (signed → presigned S3 upload URL)
  router.post('/api/report', signedFetch(), createReportHandler)

  // event posters (signed + multipart upload; parsed via the web Request's .formData())
  router.post('/api/poster', signedFetch(), createPosterHandler)
  router.post('/api/poster-vertical', signedFetch(), createVerticalPosterHandler)

  // events sitemaps (public XML)
  router.get('/events/sitemap.xml', getSitemapIndexHandler)
  router.get('/events/sitemap.static.xml', getStaticSitemapHandler)
  router.get('/events/sitemap.events.xml', getEventsSitemapHandler)
  router.get('/events/sitemap.schedules.xml', getSchedulesSitemapHandler)

  // destinations — unified places+worlds discovery (legacy + new /v1 surface)
  router.get('/api/destinations', signedFetch({ optional: true }), getDestinationsListHandler)
  router.post('/api/destinations', signedFetch({ optional: true }), getDestinationsByIdHandler)
  router.get('/v1/destinations', signedFetch({ optional: true }), getDestinationsListHandler)
  router.post('/v1/destinations/batch', signedFetch({ optional: true }), getDestinationsByIdHandler)

  // worlds (optional-signed reads, signed writes)
  router.get('/api/worlds', signedFetch({ optional: true }), getWorldListHandler)
  router.get('/api/world_names', getWorldNamesHandler)
  router.get('/api/worlds/:world_id', signedFetch({ optional: true }), getWorldHandler)
  router.patch('/api/worlds/:world_id/likes', signedFetch(), updateLikesHandler)
  router.patch('/api/worlds/:world_id/favorites', signedFetch(), updateFavoritesHandler)
  // worlds moderation (signed admin); ranking is data-team bearer
  router.put('/api/worlds/:world_id/rating', signedFetch(), requirePermission(), updateWorldRatingHandler)
  router.put('/api/worlds/:world_id/highlight', signedFetch(), requirePermission(), updateWorldHighlightHandler)
  if (withDataTeamBearer) {
    router.put('/api/worlds/:world_id/ranking', withDataTeamBearer, updateWorldRankingHandler)
  }

  // profile settings (permissions/authorization)
  router.get(
    '/api/profiles/settings',
    signedFetch(),
    requirePermission(ProfilePermission.EditAnyProfile),
    getProfileSettingsListHandler
  )
  router.get('/api/profiles/me/settings', signedFetch(), getMyProfileSettingsHandler)
  router.get(
    '/api/profiles/:profile_id/settings',
    signedFetch(),
    requirePermission(ProfilePermission.EditAnyProfile),
    getProfileSettingsHandler
  )
  router.patch(
    '/api/profiles/:profile_id/settings',
    signedFetch(),
    requirePermission(ProfilePermission.EditAnyProfile),
    updateProfileSettingsHandler
  )

  return router
}
