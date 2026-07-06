import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Destination, Event } from '../../types/entities'
import type { EventListFilters } from '../../adapters/events-repository'
import { NotFoundError, UnauthorizedError } from '../../types/errors'
import { resolveEntityType, isPlaceId } from '../../logic/entity-id'
import { refreshedSummary, type InteractionSummary } from './update-interactions-handler'
import { multiParam as multi } from './query-params'

/** `GET /v1/destinations/:id` — a single destination, optionally decorated. */
export async function getV1DestinationHandler(
  context: Pick<
    HandlerContextWithPath<'destinations', '/v1/destinations/:id'>,
    'components' | 'params' | 'url' | 'verification'
  >
): Promise<HTTPResponse<Destination>> {
  const { destinations } = context.components
  const user = context.verification?.auth?.toLowerCase()
  const withList = multi(context.url.searchParams, 'with') ?? []
  const destination = await destinations.getDestinationById(context.params.id, user, {
    withLiveEvents: withList.includes('live_events'),
    withNextEvent: withList.includes('next_event'),
    withConnectedUsers: withList.includes('connected_users')
  })
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
  const { data } = await events.getEvents(filters)
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
  const user = context.verification?.auth?.toLowerCase()
  const isAdmin = user ? profiles.isAdmin(user) : false
  const event = await events.getEvent(context.params.event_id, user, isAdmin)
  const destinationId = event.world_id ?? event.place_id ?? null
  const destination = destinationId ? await destinations.getDestinationById(destinationId, user) : null
  return { status: 200, body: { ok: true, data: { ...event, destination_id: destinationId, destination } } }
}

async function setDestinationInteraction(
  context: Pick<
    HandlerContextWithPath<'interactions' | 'places' | 'worlds'>,
    'components' | 'params' | 'request' | 'verification'
  >,
  kind: 'favorite' | 'like'
): Promise<HTTPResponse<InteractionSummary>> {
  const { interactions } = context.components
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')
  const entityId = (context.params as Record<string, string>).id
  const entityType = resolveEntityType(entityId)

  const body = (await context.request.json()) as { favorite?: unknown; like?: unknown }
  if (kind === 'favorite') {
    await interactions.setFavorite({ entityId, entityType, user, favorite: body.favorite === true })
  } else {
    const like = body.like === null || typeof body.like === 'boolean' ? (body.like as boolean | null) : false
    await interactions.setLike({ entityId, entityType, user, like })
  }
  return {
    status: 200,
    body: { ok: true, data: await refreshedSummary(context.components, entityId, entityType, user) }
  }
}

/** `PATCH /v1/destinations/:id/favorite` — `{ favorite: boolean }`. */
export async function updateV1FavoriteHandler(
  context: Pick<
    HandlerContextWithPath<'interactions' | 'places' | 'worlds', '/v1/destinations/:id/favorite'>,
    'components' | 'params' | 'request' | 'verification'
  >
): Promise<HTTPResponse<InteractionSummary>> {
  return setDestinationInteraction(context, 'favorite')
}

/** `PATCH /v1/destinations/:id/like` — `{ like: boolean | null }`. */
export async function updateV1LikeHandler(
  context: Pick<
    HandlerContextWithPath<'interactions' | 'places' | 'worlds', '/v1/destinations/:id/like'>,
    'components' | 'params' | 'request' | 'verification'
  >
): Promise<HTTPResponse<InteractionSummary>> {
  return setDestinationInteraction(context, 'like')
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
