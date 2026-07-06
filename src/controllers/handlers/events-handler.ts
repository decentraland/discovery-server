import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Event } from '../../types/entities'
import type { EventListFilters } from '../../adapters/events-repository'
import type { EventWithAttendance } from '../../logic/events'
import { BadRequestError, UnauthorizedError } from '../../types/errors'

type ListContext = { viewer?: string; isAdmin?: boolean }

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
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    offset: params.get('offset') ? Number(params.get('offset')) : undefined
  }
}

/** Legacy `GET /api/events` — filtered, paginated event list. */
export async function getEventListHandler(
  context: Pick<HandlerContextWithPath<'events' | 'profiles', '/api/events'>, 'components' | 'url' | 'verification'>
): Promise<HTTPResponse<Event[]>> {
  const viewer = context.verification?.auth?.toLowerCase()
  const isAdmin = viewer ? context.components.profiles.isAdmin(viewer) : false
  const { data, total } = await context.components.events.getEvents(
    parseFilters(context.url.searchParams, { viewer, isAdmin })
  )
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
  const user = context.verification?.auth?.toLowerCase()
  const isAdmin = user ? context.components.profiles.isAdmin(user) : false
  const data = await context.components.events.getEvent(context.params.event_id, user, isAdmin)
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

/** Legacy `PATCH /api/events/:event_id` — update an event (owner/editor). */
export async function updateEventHandler(
  context: Pick<
    HandlerContextWithPath<'events', '/api/events/:event_id'>,
    'components' | 'params' | 'request' | 'verification'
  >
): Promise<HTTPResponse<Event>> {
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  let body: any
  try {
    body = await context.request.json()
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }

  const data = await context.components.events.updateEvent(context.params.event_id, body, user)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `DELETE /api/events/:event_id` — soft-delete an event (owner/admin). */
export async function deleteEventHandler(
  context: Pick<
    HandlerContextWithPath<'events' | 'profiles', '/api/events/:event_id'>,
    'components' | 'params' | 'verification'
  >
): Promise<HTTPResponse<{ id: string }>> {
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  const byAdmin = context.components.profiles.isAdmin(user)
  await context.components.events.deleteEvent(context.params.event_id, user, byAdmin)
  return { status: 200, body: { ok: true, data: { id: context.params.event_id } } }
}
