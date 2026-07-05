import type { Queryable } from '../pg'
import type { EventAttendee } from '../../types/entities'

export interface IAttendeesRepository {
  add(client: Queryable, eventId: string, user: string, userName: string | null): Promise<void>
  remove(client: Queryable, eventId: string, user: string): Promise<void>
  listByEvent(client: Queryable, eventId: string): Promise<EventAttendee[]>
  isAttending(client: Queryable, eventId: string, user: string): Promise<boolean>
  /** Recompute events.total_attendees and events.latest_attendees (last 10) from the table. */
  recomputeCounters(client: Queryable, eventId: string): Promise<void>
}
