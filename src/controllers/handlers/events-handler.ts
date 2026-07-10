import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Event } from '../../types/entities'
import type { EventListFilters } from '../../adapters/events-repository'
import type { EventWithAttendance, IEventsComponent } from '../../logic/events'
import type { IProfilesComponent } from '../../logic/profiles'
import type { ICommsGatekeeperClient } from '../../adapters/comms-gatekeeper-client'
import { BadRequestError, UnauthorizedError } from '../../types/errors'
import { API_ADMIN_IDENTITY } from '../middlewares/authorization'
import { isPlaceId } from '../../logic/entity-id'
import { intParam, multiParam as multi, MAX_BATCH_ITEMS } from './query-params'

type ListContext = { viewer?: string; isAdmin?: boolean }

/** Parse a tri-state boolean query param: 'true' -> true, 'false' -> false, else undefined. */
function boolParam(params: URLSearchParams, key: string): boolean | undefined {
  const raw = params.get(key)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

/**
 * Resolve the requester + whether they act as admin. The admin service bearer sets
 * a synthetic `API_ADMIN_IDENTITY` verification; a signed wallet is admin when it
 * is in `ADMIN_ADDRESSES`.
 */
export function resolveViewer(
  verification: { auth?: string } | undefined,
  profiles: IProfilesComponent
): { viewer?: string; isAdmin: boolean } {
  const viewer = verification?.auth?.toLowerCase()
  if (!viewer) return { viewer: undefined, isAdmin: false }
  const isAdmin = viewer === API_ADMIN_IDENTITY || profiles.isAdmin(viewer)
  return { viewer, isAdmin }
}

function parseFilters(params: URLSearchParams, ctx: ListContext = {}): EventListFilters {
  let listParam = params.get('list')
  // Deprecated alias: list=highlight => active + highlighted.
  let highlighted = boolParam(params, 'highlighted')
  if (listParam === 'highlight') {
    listParam = 'active'
    highlighted = true
  }
  const list =
    listParam === 'live' || listParam === 'upcoming' || listParam === 'all' || listParam === 'active'
      ? listParam
      : 'active'
  // Admins may opt into pending/rejected/deleted events for moderation.
  const includeUnapproved = ctx.isAdmin ? params.get('allow_pending') === 'true' : false
  const includeDeleted = ctx.isAdmin ? params.get('allow_deleted') === 'true' : false

  // Positions are "x,y" tokens — use getAll (not multiParam) so the comma isn't split.
  const single = params.get('position')
  const positionValues = params.getAll('positions').filter(Boolean)
  const positions = single ? [single] : positionValues.length ? positionValues : undefined

  return {
    search: params.get('search') ?? undefined,
    positions,
    worldNames: multi(params, 'world_names'),
    communityId: params.get('community_id') ?? undefined,
    creator: params.get('creator') ?? undefined,
    // only_attendee / owner require auth (enforced by the handler); scoped to the viewer.
    attendee: params.get('only_attendee') === 'true' ? ctx.viewer : undefined,
    ownedBy: params.get('owner') === 'true' ? ctx.viewer : undefined,
    highlighted,
    world: boolParam(params, 'world'),
    schedule: params.get('schedule') ?? undefined,
    estateId: params.get('estate_id') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
    list,
    viewer: ctx.viewer,
    includeUnapproved,
    includeDeleted,
    // Admin-only precise moderation selectors.
    approved: ctx.isAdmin ? boolParam(params, 'approved') : undefined,
    rejected: ctx.isAdmin ? boolParam(params, 'rejected') : undefined,
    deleted: ctx.isAdmin ? boolParam(params, 'deleted') : undefined,
    limit: intParam(params, 'limit'),
    offset: intParam(params, 'offset')
  }
}

/** Events that require the caller to be authenticated (own/attending views). */
function assertAuthedFilters(params: URLSearchParams, viewer?: string): void {
  if ((params.get('only_attendee') === 'true' || params.get('owner') === 'true') && !viewer) {
    throw new UnauthorizedError('Authentication required')
  }
}

/** Decorate each event with the realtime connected addresses at its scene/world. */
async function decorateConnectedUsers(
  commsGatekeeperClient: ICommsGatekeeperClient,
  events: Event[]
): Promise<Array<Event & { connected_addresses: string[] }>> {
  return Promise.all(
    events.map(async (event) => {
      // A world event's participants come from its server; a genesis event's from its parcel.
      // A world event without a server has no scene to query, so it decorates empty.
      const connected_addresses = event.world
        ? event.server
          ? await commsGatekeeperClient.getWorldParticipants(event.server)
          : []
        : await commsGatekeeperClient.getSceneParticipants(`${event.x},${event.y}`)
      return { ...event, connected_addresses }
    })
  )
}

/** Run an event list query and apply the opt-in connected-users decoration. */
async function listAndDecorate(
  components: { events: IEventsComponent; commsGatekeeperClient: ICommsGatekeeperClient },
  params: URLSearchParams,
  filters: EventListFilters
): Promise<HTTPResponse<Event[]>> {
  const { data, total } = await components.events.getEvents(filters)
  const decorated =
    params.get('with_connected_users') === 'true'
      ? await decorateConnectedUsers(components.commsGatekeeperClient, data)
      : data
  return { status: 200, body: { ok: true, data: decorated, total } }
}

/** Legacy `GET /api/events` — filtered, paginated event list. */
export async function getEventListHandler(
  context: Pick<
    HandlerContextWithPath<'events' | 'profiles' | 'commsGatekeeperClient', '/api/events'>,
    'components' | 'url' | 'verification'
  >
): Promise<HTTPResponse<Event[]>> {
  const { viewer, isAdmin } = resolveViewer(context.verification, context.components.profiles)
  const params = context.url.searchParams
  assertAuthedFilters(params, viewer)
  return listAndDecorate(context.components, params, parseFilters(params, { viewer, isAdmin }))
}

/**
 * Legacy `POST /api/events/search` — same filters as `GET /api/events` (from the
 * query string) plus body-driven `placeIds` / `communityId`.
 */
export async function searchEventsHandler(
  context: Pick<
    HandlerContextWithPath<'events' | 'profiles' | 'commsGatekeeperClient', '/api/events/search'>,
    'components' | 'url' | 'request' | 'verification'
  >
): Promise<HTTPResponse<Event[]>> {
  const { viewer, isAdmin } = resolveViewer(context.verification, context.components.profiles)
  const params = context.url.searchParams
  assertAuthedFilters(params, viewer)
  const filters = parseFilters(params, { viewer, isAdmin })

  let body: any = {}
  try {
    body = (await context.request.json()) ?? {}
  } catch {
    // A missing/invalid body just means "no extra filters" for a search POST.
    body = {}
  }
  if (Array.isArray(body.placeIds) && body.placeIds.length) {
    if (body.placeIds.length > MAX_BATCH_ITEMS) throw new BadRequestError(`Too many placeIds (max ${MAX_BATCH_ITEMS})`)
    // Keep only well-formed uuids so a bad id can't 500 the `::uuid[]` cast.
    filters.placeIds = body.placeIds.filter((id: unknown): id is string => typeof id === 'string' && isPlaceId(id))
  }
  if (typeof body.communityId === 'string') filters.communityId = body.communityId

  return listAndDecorate(context.components, params, filters)
}

/** Legacy `GET /api/events/attending` — events the authenticated user attends. */
export async function getAttendingEventsHandler(
  context: Pick<HandlerContextWithPath<'events', '/api/events/attending'>, 'components' | 'verification'>
): Promise<HTTPResponse<Event[]>> {
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  const data = await context.components.events.getAttendingEvents(user)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `GET /api/events/:event_id` — a single event. */
export async function getEventHandler(
  context: Pick<
    HandlerContextWithPath<'events' | 'profiles', '/api/events/:event_id'>,
    'components' | 'params' | 'verification'
  >
): Promise<HTTPResponse<EventWithAttendance>> {
  const { viewer, isAdmin } = resolveViewer(context.verification, context.components.profiles)
  const data = await context.components.events.getEvent(context.params.event_id, viewer, isAdmin)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `POST /api/events` — create an event. */
export async function createEventHandler(
  context: Pick<HandlerContextWithPath<'events', '/api/events'>, 'components' | 'request' | 'verification'>
): Promise<HTTPResponse<Event>> {
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  let body: any
  try {
    body = await context.request.json()
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }

  const data = await context.components.events.createEvent(body, user)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `PATCH /api/events/:event_id` — update an event (owner/editor, or admin/admin-bearer). */
export async function updateEventHandler(
  context: Pick<
    HandlerContextWithPath<'events' | 'profiles', '/api/events/:event_id'>,
    'components' | 'params' | 'request' | 'verification'
  >
): Promise<HTTPResponse<Event>> {
  const { viewer, isAdmin } = resolveViewer(context.verification, context.components.profiles)
  if (!viewer) throw new UnauthorizedError('Authentication required')

  let body: any
  try {
    body = await context.request.json()
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }

  const actor = typeof body.actor === 'string' ? body.actor : undefined
  const data = await context.components.events.updateEvent(context.params.event_id, body, viewer, { isAdmin, actor })
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `DELETE /api/events/:event_id` — soft-delete an event (owner/admin/admin-bearer). */
export async function deleteEventHandler(
  context: Pick<
    HandlerContextWithPath<'events' | 'profiles', '/api/events/:event_id'>,
    'components' | 'params' | 'url' | 'verification'
  >
): Promise<HTTPResponse<{ id: string }>> {
  const { viewer, isAdmin } = resolveViewer(context.verification, context.components.profiles)
  if (!viewer) throw new UnauthorizedError('Authentication required')

  const actor = context.url.searchParams.get('actor') ?? undefined
  await context.components.events.deleteEvent(context.params.event_id, viewer, isAdmin, actor)
  return { status: 200, body: { ok: true, data: { id: context.params.event_id } } }
}
