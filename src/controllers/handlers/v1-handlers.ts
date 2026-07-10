import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Destination, Event } from '../../types/entities'
import type { EventListFilters } from '../../adapters/events-repository'
import { NotFoundError, UnauthorizedError } from '../../types/errors'
import { resolveEntityType, isPlaceId } from '../../logic/entity-id'
import { refreshedSummary, type InteractionSummary } from './update-interactions-handler'
import { resolveViewer } from './events-handler'
import { parseWithOptions } from './query-params'

/** `GET /v1/destinations/:id` — a single destination, optionally decorated. */
export async function getV1DestinationHandler(
  context: Pick<
    HandlerContextWithPath<'destinations', '/v1/destinations/:id'>,
    'components' | 'params' | 'url' | 'verification'
  >
): Promise<HTTPResponse<Destination>> {
  const { destinations } = context.components
  const user = context.verification?.auth?.toLowerCase()
  const destination = await destinations.getDestinationById(
    context.params.id,
    user,
    parseWithOptions(context.url.searchParams)
  )
  if (!destination) throw new NotFoundError(`Destination not found: ${context.params.id}`)
  return { status: 200, body: { ok: true, data: destination } }
}

/** `GET /v1/destinations/:id/events` — the destination's events (live first, then upcoming). */
export async function getV1DestinationEventsHandler(
  context: Pick<
    HandlerContextWithPath<'events', '/v1/destinations/:id/events'>,
    'components' | 'params' | 'verification'
  >
): Promise<HTTPResponse<Event[]>> {
  const { events } = context.components
  const viewer = context.verification?.auth?.toLowerCase()
  const id = context.params.id
  const filters: EventListFilters = isPlaceId(id)
    ? { placeIds: [id], list: 'active', viewer }
    : { worldNames: [id], list: 'active', viewer }
  const data = await events.listEvents(filters)
  // Live occurrences first, then upcoming, both by soonest start.
  const now = Date.now()
  const isLive = (event: Event) =>
    !!event.next_start_at &&
    new Date(event.next_start_at).getTime() <= now &&
    !!event.next_finish_at &&
    new Date(event.next_finish_at).getTime() >= now
  const ordered = [...data].sort((a, b) => {
    if (isLive(a) !== isLive(b)) return isLive(a) ? -1 : 1
    return new Date(a.next_start_at ?? a.start_at).getTime() - new Date(b.next_start_at ?? b.start_at).getTime()
  })
  return { status: 200, body: { ok: true, data: ordered } }
}

/** `GET /v1/events/:event_id` — legacy event shape plus destination_id and a destination summary. */
export async function getV1EventHandler(
  context: Pick<
    HandlerContextWithPath<'events' | 'destinations' | 'profiles', '/v1/events/:event_id'>,
    'components' | 'params' | 'verification'
  >
): Promise<HTTPResponse<Event & { destination_id: string | null; destination: Destination | null }>> {
  const { events, destinations, profiles } = context.components
  // Reuse the admin-bearer-aware resolver so the service bearer (API_ADMIN_IDENTITY)
  // can view pending/rejected/deleted events, matching legacy GET /api/events/:id.
  const { viewer, isAdmin } = resolveViewer(context.verification, profiles)
  const event = await events.getEvent(context.params.event_id, viewer, isAdmin)
  const destinationId = event.world_id ?? event.place_id ?? null
  const destination = destinationId ? await destinations.getDestinationById(destinationId, viewer) : null
  return { status: 200, body: { ok: true, data: { ...event, destination_id: destinationId, destination } } }
}

type InteractionContext = Pick<
  HandlerContextWithPath<'interactions' | 'places' | 'worlds'>,
  'components' | 'params' | 'request' | 'verification'
>

/** Resolve the authenticated caller + the destination entity, or throw 401. */
function interactionActor(context: InteractionContext): {
  user: string
  entityId: string
  entityType: ReturnType<typeof resolveEntityType>
} {
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')
  const entityId = (context.params as Record<string, string>).id
  return { user, entityId, entityType: resolveEntityType(entityId) }
}

async function summaryResponse(context: InteractionContext): Promise<HTTPResponse<InteractionSummary>> {
  const { user, entityId, entityType } = interactionActor(context)
  return {
    status: 200,
    body: { ok: true, data: await refreshedSummary(context.components, entityId, entityType, user) }
  }
}

/** `PUT /v1/destinations/:id/favorites` — favorite the destination for the caller. */
export async function addFavoriteHandler(context: InteractionContext): Promise<HTTPResponse<InteractionSummary>> {
  const { user, entityId, entityType } = interactionActor(context)
  await context.components.interactions.setFavorite({ entityId, entityType, user, favorite: true })
  return summaryResponse(context)
}

/** `DELETE /v1/destinations/:id/favorites` — remove the caller's favorite. */
export async function removeFavoriteHandler(context: InteractionContext): Promise<HTTPResponse<InteractionSummary>> {
  const { user, entityId, entityType } = interactionActor(context)
  await context.components.interactions.setFavorite({ entityId, entityType, user, favorite: false })
  return summaryResponse(context)
}

/** `PUT /v1/destinations/:id/likes` — `{ like: boolean }` (true = like, false = dislike). */
export async function putLikeHandler(context: InteractionContext): Promise<HTTPResponse<InteractionSummary>> {
  const { user, entityId, entityType } = interactionActor(context)
  const body = (await context.request.json()) as { like?: unknown }
  await context.components.interactions.setLike({ entityId, entityType, user, like: body.like === true })
  return summaryResponse(context)
}

/** `DELETE /v1/destinations/:id/likes` — clear the caller's like/dislike. */
export async function removeLikeHandler(context: InteractionContext): Promise<HTTPResponse<InteractionSummary>> {
  const { user, entityId, entityType } = interactionActor(context)
  await context.components.interactions.setLike({ entityId, entityType, user, like: null })
  return summaryResponse(context)
}

/** `GET /v1/categories?target=destinations|events` — unified category listing. */
export async function getV1CategoriesHandler(
  context: Pick<HandlerContextWithPath<'categories', '/v1/categories'>, 'components' | 'url'>
): Promise<HTTPResponse<unknown>> {
  const { categories } = context.components
  const target = context.url.searchParams.get('target') ?? 'destinations'
  if (target === 'events') {
    const data = await categories.getEventCategories()
    return { status: 200, body: { ok: true, data } }
  }
  const data = await categories.getPlaceCategories('all')
  return { status: 200, body: { ok: true, data } }
}
