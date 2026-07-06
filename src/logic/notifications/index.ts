import { Events } from '@dcl/schemas'
import type { AppComponents } from '../../types'
import type { Event } from '../../types/entities'
import type { PublishableEvents } from '../../adapters/sns-publisher'

const UPCOMING_WINDOW_MS = 60 * 60 * 1000
const CURSOR_STARTS_SOON = 'events_starts_soon'
const CURSOR_STARTED = 'events_started'
const CURSOR_ENDED = 'events_ended'

export interface INotificationsComponent {
  /** Notify attendees of events entering the "starts within 1h" window. Returns count published. */
  notifyUpcoming(): Promise<number>
  /** Notify attendees of events that just started. */
  notifyStarted(): Promise<number>
  /** Emit an ended notification per event that just finished. */
  notifyEnded(): Promise<number>
}

/**
 * The three SNS notification crons. Each is idempotent via a per-type cursor in
 * `notification_cursors`: it processes the half-open window (lastRun, now] (offset
 * by +1h for upcoming) and advances the cursor to now. On the first run the cursor
 * is seeded to now so history is not replayed. Publishing is a no-op when SNS is
 * unconfigured, but the cursor still advances (dev/test).
 */
export async function createNotificationsComponent(
  components: Pick<
    AppComponents,
    | 'pg'
    | 'eventsRepository'
    | 'attendeesRepository'
    | 'notificationCursorsRepository'
    | 'snsPublisher'
    | 'config'
    | 'logs'
  >
): Promise<INotificationsComponent> {
  const { pg, eventsRepository, attendeesRepository, notificationCursorsRepository, snsPublisher, config } = components

  const eventsBaseUrl = ((await config.getString('EVENTS_BASE_URL')) ?? 'https://events.decentraland.org').replace(
    /\/$/,
    ''
  )
  const link = (event: Event) => `${eventsBaseUrl}/event/${event.id}`

  async function lastRun(cursorId: string, now: number): Promise<number> {
    const cursor = await notificationCursorsRepository.get(pg, cursorId)
    return cursor?.last_successful_run_at ?? now
  }

  async function notifyUpcoming(): Promise<number> {
    const now = Date.now()
    const since = await lastRun(CURSOR_STARTS_SOON, now)
    const events = await eventsRepository.findInStartWindow(pg, since + UPCOMING_WINDOW_MS, now + UPCOMING_WINDOW_MS)

    const payload: PublishableEvents = []
    for (const event of events) {
      const attendees = await attendeesRepository.listByEvent(pg, event.id)
      for (const attendee of attendees) {
        payload.push({
          type: Events.Type.EVENT,
          subType: Events.SubType.Event.EVENT_STARTS_SOON,
          key: `${event.id}-${attendee.user}-starts-soon`,
          timestamp: now,
          metadata: {
            name: event.name,
            image: event.image ?? '',
            link: link(event),
            startsAt: (event.next_start_at ?? event.start_at).toISOString(),
            endsAt: (event.next_finish_at ?? event.finish_at).toISOString(),
            title: event.name,
            description: event.description ?? '',
            attendee: attendee.user
          }
        } as never)
      }
    }

    const { published } = await snsPublisher.publish(payload)
    await notificationCursorsRepository.set(pg, CURSOR_STARTS_SOON, now)
    return published
  }

  async function notifyStarted(): Promise<number> {
    const now = Date.now()
    const since = await lastRun(CURSOR_STARTED, now)
    const events = await eventsRepository.findInStartWindow(pg, since, now)

    const payload: PublishableEvents = []
    for (const event of events) {
      const attendees = await attendeesRepository.listByEvent(pg, event.id)
      for (const attendee of attendees) {
        payload.push({
          type: Events.Type.EVENT,
          subType: Events.SubType.Event.EVENT_STARTED,
          key: `${event.id}-${attendee.user}-started`,
          timestamp: now,
          metadata: {
            name: event.name,
            image: event.image ?? '',
            link: link(event),
            title: event.name,
            description: event.description ?? '',
            attendee: attendee.user,
            ...(event.community_id ? { communityId: event.community_id } : {})
          }
        } as never)
      }
    }

    const { published } = await snsPublisher.publish(payload)
    await notificationCursorsRepository.set(pg, CURSOR_STARTED, now)
    return published
  }

  async function notifyEnded(): Promise<number> {
    const now = Date.now()
    const since = await lastRun(CURSOR_ENDED, now)
    const events = await eventsRepository.findInFinishWindow(pg, since, now)

    const payload: PublishableEvents = events.map(
      (event) =>
        ({
          type: Events.Type.EVENT,
          subType: Events.SubType.Event.EVENT_ENDED,
          key: `${event.id}-ended`,
          timestamp: now,
          metadata: {
            totalAttendees: event.total_attendees,
            ...(event.community_id ? { communityId: event.community_id } : {})
          }
        }) as never
    )

    const { published } = await snsPublisher.publish(payload)
    await notificationCursorsRepository.set(pg, CURSOR_ENDED, now)
    return published
  }

  return { notifyUpcoming, notifyStarted, notifyEnded }
}
