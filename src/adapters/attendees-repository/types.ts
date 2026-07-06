import type { Queryable } from '../pg'
import type { EventAttendee } from '../../types/entities'

export interface IAttendeesRepository {
  add(client: Queryable, eventId: string, user: string, userName: string | null): Promise<void>
  remove(client: Queryable, eventId: string, user: string): Promise<void>
  listByEvent(client: Queryable, eventId: string): Promise<EventAttendee[]>
  isAttending(client: Queryable, eventId: string, user: string): Promise<boolean>
  /**
   * Take a row lock on the event so concurrent attend/unattend on the same event
   * serialize; call inside the transaction before recomputeCounters to avoid a
   * lost-update race on the denormalized counters.
   */
  lockEvent(client: Queryable, eventId: string): Promise<void>
  /** Recompute events.total_attendees and events.latest_attendees (last 10) from the table. */
  recomputeCounters(client: Queryable, eventId: string): Promise<void>
}
