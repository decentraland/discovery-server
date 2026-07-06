import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Event } from '../../types/entities'
import type { EventListFilters } from '../../adapters/events-repository'
import type { EventWithAttendance } from '../../logic/events'
import type { IProfilesComponent } from '../../logic/profiles'
import { BadRequestError, UnauthorizedError } from '../../types/errors'
import { API_ADMIN_IDENTITY } from '../middlewares/authorization'
import { intParam } from './query-params'

type ListContext = { viewer?: string; isAdmin?: boolean }

/**
 * Resolve the requester + whether they act as admin. The admin service bearer sets
 * a synthetic `API_ADMIN_IDENTITY` verification; a signed wallet is admin when it
 * is in `ADMIN_ADDRESSES`.
 */
function resolveViewer(
  verification: { auth?: string } | undefined,
  profiles: IProfilesComponent
): { viewer?: string; isAdmin: boolean } {
  const viewer = verification?.auth?.toLowerCase()
  if (!viewer) return { viewer: undefined, isAdmin: false }
  const isAdmin = viewer === API_ADMIN_IDENTITY || profiles.isAdmin(viewer)
  return { viewer, isAdmin }
}

function parseFilters(params: URLSearchParams, ctx: ListContext = {}): EventListFilters {
  const listParam = params.get('list')
  // Legacy default is the "active" feed (events not yet finished); `all` is opt-in.
  const list =
    listParam === 'live' || listParam === 'upcoming' || listParam === 'all' || listParam === 'active'
      ? listParam
      : 'active'
  // Admins may opt into pending/rejected/deleted events for moderation.
  const includeUnapproved = ctx.isAdmin ? params.get('allow_pending') === 'true' : false
  const includeDeleted = ctx.isAdmin ? params.get('allow_deleted') === 'true' : false
  return {
    search: params.get('search') ?? undefined,
    communityId: params.get('community_id') ?? undefined,
    creator: params.get('creator') ?? undefined,
    list,
    viewer: ctx.viewer,
    includeUnapproved,
    includeDeleted,
    limit: intParam(params, 'limit'),
    offset: intParam(params, 'offset')
  }
}

/** Legacy `GET /api/events` — filtered, paginated event list. */
export async function getEventListHandler(
  context: Pick<HandlerContextWithPath<'events' | 'profiles', '/api/events'>, 'components' | 'url' | 'verification'>
): Promise<HTTPResponse<Event[]>> {
  const { viewer, isAdmin } = resolveViewer(context.verification, context.components.profiles)
  const { data, total } = await context.components.events.getEvents(
    parseFilters(context.url.searchParams, { viewer, isAdmin })
  )
  return { status: 200, body: { ok: true, data, total } }
}

/**
 * Legacy `POST /api/events/search` — same filters as `GET /api/events` (from the
 * query string) plus body-driven `placeIds` / `communityId`.
 */
export async function searchEventsHandler(
  context: Pick<
    HandlerContextWithPath<'events' | 'profiles', '/api/events/search'>,
    'components' | 'url' | 'request' | 'verification'
  >
): Promise<HTTPResponse<Event[]>> {
  const { viewer, isAdmin } = resolveViewer(context.verification, context.components.profiles)
  const filters = parseFilters(context.url.searchParams, { viewer, isAdmin })

  let body: any = {}
  try {
    body = (await context.request.json()) ?? {}
  } catch {
    // A missing/invalid body just means "no extra filters" for a search POST.
    body = {}
  }
  if (Array.isArray(body.placeIds) && body.placeIds.length) {
    filters.placeIds = body.placeIds.filter((id: unknown) => typeof id === 'string')
  }
  if (typeof body.communityId === 'string') filters.communityId = body.communityId

  const { data, total } = await context.components.events.getEvents(filters)
  return { status: 200, body: { ok: true, data, total } }
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
