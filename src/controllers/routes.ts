import { Router, createBodySizeLimitMiddleware } from '@dcl/http-server'
import type { GlobalContext } from '../types'
import { errorHandler } from './middlewares/error-handler'
import { cacheControlForAuthenticated } from './middlewares/cache-control'
import { createEventSchema, updateEventSchema } from './schemas/event-schemas'
import { createSignedFetchMiddleware } from './middlewares/signed-fetch'
import { pingHandler } from './handlers/ping-handler'
import { statusHandler } from './handlers/status-handler'
import { getCategoriesHandler } from './handlers/get-categories-handler'
import { getEventCategoriesHandler } from './handlers/get-event-categories-handler'
import {
  createScheduleHandler,
  getScheduleByIdHandler,
  getSchedulesHandler,
  updateScheduleHandler
} from './handlers/get-schedules-handler'
import {
  getPlaceCategoriesHandler,
  getPlaceHandler,
  getPlaceListByIdHandler,
  getPlaceListHandler,
  getPlaceStatusListHandler
} from './handlers/get-places-handler'
import { getMapHandler, getMapPlacesHandler } from './handlers/map-handler'
import { getWorldHandler, getWorldListHandler, getWorldNamesHandler } from './handlers/get-worlds-handler'
import { updateFavoritesHandler, updateLikesHandler } from './handlers/update-interactions-handler'
import {
  createAdminAuth,
  createOptionalSignedOrAdminBearer,
  createRequirePermission
} from './middlewares/authorization'
import { ProfilePermission } from '../types/entities'
import {
  getMyProfileSettingsHandler,
  getProfileSettingsHandler,
  getProfileSettingsListHandler,
  updateMyProfileSettingsHandler,
  updateProfileSettingsHandler
} from './handlers/profile-settings-handler'
import {
  createEventHandler,
  deleteEventHandler,
  getAttendingEventsHandler,
  getEventHandler,
  getEventListHandler,
  searchEventsHandler,
  updateEventHandler
} from './handlers/events-handler'
import { createAttendeeHandler, deleteAttendeeHandler, getAttendeesHandler } from './handlers/attendees-handler'
import { getDestinationsByIdHandler, getDestinationsListHandler } from './handlers/destinations-handler'
import {
  addFavoriteHandler,
  getV1CategoriesHandler,
  getV1DestinationEventsHandler,
  getV1DestinationHandler,
  getV1EventHandler,
  putLikeHandler,
  removeFavoriteHandler,
  removeLikeHandler
} from './handlers/v1-handlers'
import { createReportHandler } from './handlers/report-handler'
import {
  getEventsSitemapHandler,
  getSchedulesSitemapHandler,
  getSitemapIndexHandler,
  getStaticSitemapHandler
} from './handlers/sitemap-handler'
import { createPosterHandler, createVerticalPosterHandler } from './handlers/posters-handler'
import { getPlaceSocialHandler, getWorldSocialHandler } from './handlers/social-handler'
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
 * signed fetch; writes require it. Legacy `/api/*` routes and the unified `/v1/*`
 * discovery layer are both served here.
 */
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()
  const { components } = globalContext
  const signedFetch = createSignedFetchMiddleware(components.fetcher)
  const requirePermission = createRequirePermission(components.profiles)
  const dataTeamToken = await components.config.getString('DATA_TEAM_AUTH_TOKEN')
  // Data-team ranking routes are only mounted when their bearer token is configured.
  const withDataTeamBearer = dataTeamToken ? createAnyBearerMiddleware([dataTeamToken]) : undefined
  // Service admin bearer tokens (unified + legacy rotation aliases).
  const adminTokens = [
    await components.config.getString('API_ADMIN_TOKEN'),
    await components.config.getString('LEGACY_PLACES_ADMIN_AUTH_TOKEN'),
    await components.config.getString('LEGACY_EVENTS_ADMIN_AUTH_TOKEN')
  ]
  // Moderation routes: signed admin wallet OR the service admin bearer.
  const adminAuth = createAdminAuth(components.fetcher, components.profiles, adminTokens)
  // Events read/moderation routes: optional-signed, with the admin bearer unlocking
  // the admin view (pending/rejected/deleted) and moderation.
  const eventsAuth = createOptionalSignedOrAdminBearer(components.fetcher, adminTokens)
  // Schema validation for the like body (validates a clone; the body stays readable).
  // true = like, false = dislike; clearing is a DELETE, so null is not accepted here.
  const validateLike = components.schemaValidator.withSchemaValidatorMiddleware({
    type: 'object',
    properties: { like: { type: 'boolean' } },
    required: ['like'],
    additionalProperties: false
  })
  // Validate the event create/update bodies (types + recurrence bounds) before the handler.
  const validateCreateEvent = components.schemaValidator.withSchemaValidatorMiddleware(createEventSchema)
  const validateUpdateEvent = components.schemaValidator.withSchemaValidatorMiddleware(updateEventSchema)

  router.use(errorHandler)
  // Reject oversized request bodies at the transport layer (before buffering) so an
  // unauthenticated caller can't OOM the process with a giant body. The limit sits above
  // the 500KB poster upload; JSON list/search bodies are far smaller.
  const maxBodySize = (await components.config.getNumber('HTTP_MAX_BODY_SIZE')) ?? 1024 * 1024
  router.use(createBodySizeLimitMiddleware(maxBodySize))
  // Signed (per-user) responses must never be served from a shared cache to another user.
  router.use(cacheControlForAuthenticated)

  router.get('/ping', pingHandler)
  router.get('/api/status', statusHandler)

  // categories (public reads) — legacy places + events surfaces
  // @deprecated — superseded by GET /v1/categories?target=destinations
  router.get('/api/categories', getCategoriesHandler)
  // @deprecated — superseded by GET /v1/categories?target=events
  router.get('/api/events/categories', getEventCategoriesHandler)

  // schedules (public reads; writes gated by EditAnySchedule)
  router.get('/api/schedules', getSchedulesHandler)
  router.get('/api/schedules/:schedule_id', getScheduleByIdHandler)
  router.post(
    '/api/schedules',
    signedFetch(),
    requirePermission(ProfilePermission.EditAnySchedule),
    createScheduleHandler
  )
  router.patch(
    '/api/schedules/:schedule_id',
    signedFetch(),
    requirePermission(ProfilePermission.EditAnySchedule),
    updateScheduleHandler
  )

  // events — static/collection routes registered before the :event_id matcher.
  // eventsAuth = optional-signed + admin bearer (unlocks the admin view/moderation).
  // @deprecated — superseded by GET /v1/events
  router.get('/api/events', eventsAuth, getEventListHandler)
  router.post('/api/events/search', eventsAuth, searchEventsHandler)
  router.post('/api/events', signedFetch(), validateCreateEvent, createEventHandler)
  router.get('/api/events/attending', signedFetch(), getAttendingEventsHandler)
  // @deprecated — superseded by GET /v1/events/:event_id
  router.get('/api/events/:event_id', eventsAuth, getEventHandler)
  router.patch('/api/events/:event_id', eventsAuth, validateUpdateEvent, updateEventHandler)
  router.delete('/api/events/:event_id', eventsAuth, deleteEventHandler)
  router.get('/api/events/:event_id/attendees', getAttendeesHandler)
  router.post('/api/events/:event_id/attendees', signedFetch(), createAttendeeHandler)
  router.delete('/api/events/:event_id/attendees', signedFetch(), deleteAttendeeHandler)

  // places (optional-signed reads, signed writes)
  router.get('/api/places', signedFetch({ optional: true }), getPlaceListHandler)
  router.post('/api/places', signedFetch({ optional: true }), getPlaceListByIdHandler)
  router.post('/api/places/status', getPlaceStatusListHandler)
  router.get('/api/places/:place_id', signedFetch({ optional: true }), getPlaceHandler)
  router.get('/api/places/:place_id/categories', getPlaceCategoriesHandler)
  // @deprecated — superseded by PATCH /v1/destinations/:id/like
  router.patch('/api/places/:entity_id/likes', signedFetch(), updateLikesHandler)
  // @deprecated — superseded by PATCH /v1/destinations/:id/favorite
  router.patch('/api/places/:entity_id/favorites', signedFetch(), updateFavoritesHandler)
  // places moderation (signed admin or service admin bearer); ranking is data-team bearer
  router.put('/api/places/:place_id/rating', adminAuth, updatePlaceRatingHandler)
  router.put('/api/places/:place_id/highlight', adminAuth, updatePlaceHighlightHandler)
  router.put('/api/places/:place_id/disable', adminAuth, updatePlaceDisabledHandler)
  if (withDataTeamBearer) {
    router.put('/api/places/:place_id/ranking', withDataTeamBearer, updatePlaceRankingHandler)
  }

  // map (optional-signed reads): genesis keyed feed + unified places+worlds list
  router.get('/api/map', signedFetch({ optional: true }), getMapHandler)
  router.get('/api/map/places', signedFetch({ optional: true }), getMapPlacesHandler)

  // content-moderation report (signed → presigned S3 upload URL)
  router.post('/api/report', signedFetch(), createReportHandler)

  // event posters (signed + multipart upload; parsed via the web Request's .formData())
  router.post('/api/poster', signedFetch(), createPosterHandler)
  router.post('/api/poster-vertical', signedFetch(), createVerticalPosterHandler)

  // link-preview (Open Graph) HTML for place/world share pages (public)
  router.get('/places/place/', getPlaceSocialHandler)
  router.get('/places/world/', getWorldSocialHandler)

  // events sitemaps (public XML)
  router.get('/events/sitemap.xml', getSitemapIndexHandler)
  router.get('/events/sitemap.static.xml', getStaticSitemapHandler)
  router.get('/events/sitemap.events.xml', getEventsSitemapHandler)
  router.get('/events/sitemap.schedules.xml', getSchedulesSitemapHandler)

  // destinations — unified places+worlds discovery (legacy + new /v1 surface)
  // @deprecated — superseded by GET /v1/destinations
  router.get('/api/destinations', signedFetch({ optional: true }), getDestinationsListHandler)
  // @deprecated — superseded by GET /v1/destinations?ids=
  router.post('/api/destinations', signedFetch({ optional: true }), getDestinationsByIdHandler)
  // by-ids lookup is folded into the collection via ?ids=/?positions=/?world_names=
  router.get('/v1/destinations', signedFetch({ optional: true }), getDestinationsListHandler)
  // More specific v1 destination routes before the :id matcher.
  router.get('/v1/destinations/:id/events', signedFetch({ optional: true }), getV1DestinationEventsHandler)
  // favorites / likes are sub-resources: PUT to set, DELETE to clear.
  router.put('/v1/destinations/:id/favorites', signedFetch(), addFavoriteHandler)
  router.delete('/v1/destinations/:id/favorites', signedFetch(), removeFavoriteHandler)
  router.put('/v1/destinations/:id/likes', signedFetch(), validateLike, putLikeHandler)
  router.delete('/v1/destinations/:id/likes', signedFetch(), removeLikeHandler)
  router.get('/v1/destinations/:id', signedFetch({ optional: true }), getV1DestinationHandler)

  // v1 events + categories (events reuse the admin-bearer-aware auth)
  router.get('/v1/events', eventsAuth, getEventListHandler)
  router.get('/v1/events/:event_id', eventsAuth, getV1EventHandler)
  router.get('/v1/categories', getV1CategoriesHandler)

  // worlds (optional-signed reads, signed writes)
  router.get('/api/worlds', signedFetch({ optional: true }), getWorldListHandler)
  router.get('/api/world_names', getWorldNamesHandler)
  router.get('/api/worlds/:world_id', signedFetch({ optional: true }), getWorldHandler)
  // @deprecated — superseded by PATCH /v1/destinations/:id/like
  router.patch('/api/worlds/:world_id/likes', signedFetch(), updateLikesHandler)
  // @deprecated — superseded by PATCH /v1/destinations/:id/favorite
  router.patch('/api/worlds/:world_id/favorites', signedFetch(), updateFavoritesHandler)
  // worlds moderation (signed admin or service admin bearer); ranking is data-team bearer
  router.put('/api/worlds/:world_id/rating', adminAuth, updateWorldRatingHandler)
  router.put('/api/worlds/:world_id/highlight', adminAuth, updateWorldHighlightHandler)
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
  router.patch('/api/profiles/me/settings', signedFetch(), updateMyProfileSettingsHandler)
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
