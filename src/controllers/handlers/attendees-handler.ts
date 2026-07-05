import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { EventAttendee } from '../../types/entities'
import { UnauthorizedError } from '../../types/errors'

/** Legacy `GET /api/events/:event_id/attendees` — public list of attendees. */
export async function getAttendeesHandler(
  context: Pick<HandlerContextWithPath<'attendees', '/api/events/:event_id/attendees'>, 'components' | 'params'>
): Promise<HTTPResponse<EventAttendee[]>> {
  const data = await context.components.attendees.getAttendees(context.params.event_id)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `POST /api/events/:event_id/attendees` — mark the authenticated user as attending. */
export async function createAttendeeHandler(
  context: Pick<
    HandlerContextWithPath<'attendees', '/api/events/:event_id/attendees'>,
    'components' | 'params' | 'verification'
  >
): Promise<HTTPResponse<EventAttendee[]>> {
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  await context.components.attendees.attend(context.params.event_id, user, null)
  const data = await context.components.attendees.getAttendees(context.params.event_id)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `DELETE /api/events/:event_id/attendees` — remove the user's attendance. */
export async function deleteAttendeeHandler(
  context: Pick<
    HandlerContextWithPath<'attendees', '/api/events/:event_id/attendees'>,
    'components' | 'params' | 'verification'
  >
): Promise<HTTPResponse<EventAttendee[]>> {
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  await context.components.attendees.unattend(context.params.event_id, user)
  const data = await context.components.attendees.getAttendees(context.params.event_id)
  return { status: 200, body: { ok: true, data } }
}
