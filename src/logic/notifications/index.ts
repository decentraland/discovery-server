import { Events } from '@dcl/schemas'
import type { AppComponents } from '../../types'
import type { Event } from '../../types/entities'
import type { PublishableEvents } from '../../adapters/sns-publisher'

const UPCOMING_WINDOW_MS = 60 * 60 * 1000
const CURSOR_STARTS_SOON = 'events_starts_soon'
const CURSOR_STARTED = 'events_started'
const CURSOR_ENDED = 'events_ended'
// Cap how far back a cron catches up. During normal operation the window is one interval;
// after downtime (or a stalled cursor) this bounds the query/fan-out and skips stale events
// nobody wants a "starts soon"/"started" notification for anymore.
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000
// Bound the description embedded in each SNS message so one event with a huge description
// can't blow the 256KB PublishBatch limit and stall the cursor. Full text stays in the DB/API.
const NOTIFICATION_DESCRIPTION_MAX = 1000

const truncate = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text)

export interface INotificationsComponent {
  /** Notify attendees of events entering the "starts within 1h" window. Returns count published. */
  notifyUpcoming(): Promise<number>
  /** Notify attendees of events that just started. */
  notifyStarted(): Promise<number>
  /** Emit an ended notification per event that just finished. */
  notifyEnded(): Promise<number>
  /** Notify the creator that their event was approved by a moderator. Never throws. */
  notifyEventApproved(event: Event): Promise<void>
  /** Notify the creator that their event was rejected by a moderator. Never throws. */
  notifyEventRejected(event: Event, reason: string): Promise<void>
  /** Notify the creator that their event was deleted by a moderator/admin. Never throws. */
  notifyEventDeleted(event: Event, reason?: string): Promise<void>
  /**
   * Fan a "Community Event Added" notification out to every member of the event's
   * community. Called when a community-attached event becomes public (approved).
   * A no-op (and never throws) when the event has no community or communities is
   * unconfigured.
   */
  notifyCommunityEventPublished(event: Event): Promise<void>
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
    | 'communitiesClient'
    | 'config'
    | 'logs'
  >
): Promise<INotificationsComponent> {
  const {
    pg,
    eventsRepository,
    attendeesRepository,
    notificationCursorsRepository,
    snsPublisher,
    communitiesClient,
    config,
    logs
  } = components

  const logger = logs.getLogger('notifications')

  const eventsBaseUrl = ((await config.getString('EVENTS_BASE_URL')) ?? 'https://events.decentraland.org').replace(
    /\/$/,
    ''
  )
  const link = (event: Event) => `${eventsBaseUrl}/event/${event.id}`
  // Occurrence identity for the idempotency key. A recurrent event reuses the
  // same id across occurrences, so the key must include the occurrence instant
  // or downstream dedup would drop every occurrence after the first.
  const startOccurrence = (event: Event) => (event.next_start_at ?? event.start_at).getTime()
  const finishOccurrence = (event: Event) => (event.next_finish_at ?? event.finish_at).getTime()

  async function lastRun(cursorId: string, now: number): Promise<number> {
    const cursor = await notificationCursorsRepository.get(pg, cursorId)
    // Never look back further than MAX_LOOKBACK_MS, so a stalled/old cursor can't make the
    // window (and the per-event/per-community fan-out) grow without bound.
    return Math.max(cursor?.last_successful_run_at ?? now, now - MAX_LOOKBACK_MS)
  }

  /**
   * Advance the cursor only when the whole batch published. If any event was
   * rejected by SNS, leave the cursor so the window is retried next run;
   * already-published events are deduped downstream by their occurrence key.
   */
  async function advanceCursorIfClean(cursorId: string, now: number, failed: number): Promise<void> {
    if (failed === 0) await notificationCursorsRepository.set(pg, cursorId, now)
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
          key: `${event.id}-${startOccurrence(event)}-${attendee.user}-starts-soon`,
          timestamp: now,
          metadata: {
            name: event.name,
            image: event.image ?? '',
            link: link(event),
            startsAt: (event.next_start_at ?? event.start_at).toISOString(),
            endsAt: (event.next_finish_at ?? event.finish_at).toISOString(),
            title: event.name,
            description: truncate(event.description ?? '', NOTIFICATION_DESCRIPTION_MAX),
            attendee: attendee.user
          }
        } as never)
      }
    }

    const { published, failed } = await snsPublisher.publish(payload)
    await advanceCursorIfClean(CURSOR_STARTS_SOON, now, failed)
    return published
  }

  async function notifyStarted(): Promise<number> {
    const now = Date.now()
    const since = await lastRun(CURSOR_STARTED, now)
    const events = await eventsRepository.findInStartWindow(pg, since, now)

    const payload: PublishableEvents = []
    for (const event of events) {
      // Explicit attendees always get notified; community-attached events also
      // reach every community member. A member who is also an attendee is
      // notified once (deduped by lowercased address).
      const recipients = new Set<string>()
      const attendees = await attendeesRepository.listByEvent(pg, event.id)
      for (const attendee of attendees) recipients.add(attendee.user.toLowerCase())
      if (event.community_id && communitiesClient.enabled) {
        for (const member of await communitiesClient.getCommunityMembers(event.community_id)) {
          recipients.add(member)
        }
      }

      for (const recipient of recipients) {
        payload.push({
          type: Events.Type.EVENT,
          subType: Events.SubType.Event.EVENT_STARTED,
          key: `${event.id}-${startOccurrence(event)}-${recipient}-started`,
          timestamp: now,
          metadata: {
            name: event.name,
            image: event.image ?? '',
            link: link(event),
            title: event.name,
            description: truncate(event.description ?? '', NOTIFICATION_DESCRIPTION_MAX),
            attendee: recipient,
            ...(event.community_id ? { communityId: event.community_id } : {})
          }
        } as never)
      }
    }

    const { published, failed } = await snsPublisher.publish(payload)
    await advanceCursorIfClean(CURSOR_STARTED, now, failed)
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
          key: `${event.id}-${finishOccurrence(event)}-ended`,
          timestamp: now,
          metadata: {
            totalAttendees: event.total_attendees,
            ...(event.community_id ? { communityId: event.community_id } : {})
          }
        }) as never
    )

    const { published, failed } = await snsPublisher.publish(payload)
    await advanceCursorIfClean(CURSOR_ENDED, now, failed)
    return published
  }

  // Shared metadata for the creator-facing moderation notifications (approved/rejected/deleted).
  const moderationMetadata = (event: Event) => ({
    host: event.user,
    title: event.name,
    description: truncate(event.description ?? '', NOTIFICATION_DESCRIPTION_MAX),
    image: event.image ?? ''
  })

  // Publish a single lifecycle notification, swallowing errors so a notification failure
  // never fails the event mutation that triggered it (legacy parity).
  async function publishLifecycle(kind: string, payload: PublishableEvents): Promise<void> {
    try {
      await snsPublisher.publish(payload)
    } catch (error: any) {
      logger.warn(`Failed to publish ${kind} notification: ${error?.message ?? String(error)}`)
    }
  }

  async function notifyEventApproved(event: Event): Promise<void> {
    await publishLifecycle('event-approved', [
      {
        type: Events.Type.EVENT,
        subType: Events.SubType.Event.EVENT_APPROVED,
        key: event.id,
        timestamp: Date.now(),
        metadata: { ...moderationMetadata(event), link: link(event) }
      } as never
    ])
  }

  async function notifyEventRejected(event: Event, reason: string): Promise<void> {
    await publishLifecycle('event-rejected', [
      {
        type: Events.Type.EVENT,
        subType: Events.SubType.Event.EVENT_REJECTED,
        key: event.id,
        timestamp: Date.now(),
        metadata: { ...moderationMetadata(event), reason }
      } as never
    ])
  }

  async function notifyEventDeleted(event: Event, reason?: string): Promise<void> {
    await publishLifecycle('event-deleted', [
      {
        type: Events.Type.EVENT,
        subType: Events.SubType.Event.EVENT_DELETED,
        key: event.id,
        timestamp: Date.now(),
        metadata: { ...moderationMetadata(event), ...(reason ? { reason } : {}) }
      } as never
    ])
  }

  async function notifyCommunityEventPublished(event: Event): Promise<void> {
    if (!event.community_id || !communitiesClient.enabled) return
    try {
      const [community, members] = await Promise.all([
        communitiesClient.getCommunity(event.community_id),
        communitiesClient.getCommunityMembers(event.community_id)
      ])
      if (!community || !members.length) return
      const now = Date.now()
      const description = `The ${community.name} Community has added a new event.`
      const payload: PublishableEvents = members.map(
        (member) =>
          ({
            type: Events.Type.EVENT,
            subType: Events.SubType.Event.EVENT_CREATED,
            // One notification per member per event; dedup key includes the member.
            key: `${event.id}-${member}-created`,
            timestamp: now,
            metadata: {
              title: 'Community Event Added',
              description,
              name: event.name,
              image: event.image ?? '',
              communityId: community.id,
              communityName: community.name,
              communityThumbnail: community.thumbnailRaw,
              attendee: member
            }
          }) as never
      )
      await snsPublisher.publish(payload)
    } catch (error: any) {
      logger.warn(`Failed to publish community-event notification for ${event.id}: ${error?.message ?? String(error)}`)
    }
  }

  return {
    notifyUpcoming,
    notifyStarted,
    notifyEnded,
    notifyEventApproved,
    notifyEventRejected,
    notifyEventDeleted,
    notifyCommunityEventPublished
  }
}
