import type { Event } from '../../types/entities'
import type { EventListFilters } from '../../adapters/events-repository'
import type { Frequency } from '../recurrence'

export type CreateEventPayload = {
  name: string
  description?: string | null
  image?: string | null
  image_vertical?: string | null
  contact?: string | null
  details?: string | null
  url?: string | null
  start_at: string | Date
  finish_at?: string | Date
  duration?: number
  all_day?: boolean
  x?: number
  y?: number
  server?: string | null
  world?: boolean
  estate_id?: string | null
  estate_name?: string | null
  scene_name?: string | null
  community_id?: string | null
  categories?: string[]
  schedules?: string[]
  user_name?: string | null
  recurrent?: boolean
  recurrent_frequency?: Frequency | null
  recurrent_interval?: number
  recurrent_count?: number | null
  recurrent_until?: string | Date | null
  recurrent_weekday_mask?: number
  recurrent_month_mask?: number
  recurrent_setpos?: number | null
  recurrent_monthday?: number | null
}

export type UpdateEventPayload = Partial<CreateEventPayload> & {
  /** Moderation fields — only applied for holders of the relevant permission. */
  approved?: boolean
  rejected?: boolean
  rejection_reason?: string | null
  highlighted?: boolean
}

/** An event decorated with the requesting user's attendance flag. */
export type EventWithAttendance = Event & { attending: boolean }

export interface IEventsComponent {
  getEvent(id: string, user?: string, isAdmin?: boolean): Promise<EventWithAttendance>
  getEvents(filters: EventListFilters): Promise<{ data: Event[]; total: number }>
  /** List events without computing the total (for callers that don't paginate). */
  listEvents(filters: EventListFilters): Promise<Event[]>
  getAttendingEvents(user: string): Promise<Event[]>
  createEvent(payload: CreateEventPayload, user: string): Promise<Event>
  /**
   * Update an event. `options.isAdmin` grants the moderation fields
   * (approve/reject/highlight) without a per-wallet permission; `options.actor`
   * overrides the recorded moderator identity (admin automation).
   */
  updateEvent(
    id: string,
    patch: UpdateEventPayload,
    user: string,
    options?: { isAdmin?: boolean; actor?: string }
  ): Promise<Event>
  deleteEvent(id: string, user: string, byAdmin: boolean, actor?: string): Promise<void>
  /** Cron: recompute next_start_at/next_finish_at/recurrent_dates for recurrent events whose window passed. Returns the count updated. */
  updateNextStartAt(batchSize?: number): Promise<number>
}
