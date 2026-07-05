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

export type UpdateEventPayload = Partial<CreateEventPayload>

/** An event decorated with the requesting user's attendance flag. */
export type EventWithAttendance = Event & { attending: boolean }

export interface IEventsComponent {
  getEvent(id: string, user?: string, isAdmin?: boolean): Promise<EventWithAttendance>
  getEvents(filters: EventListFilters): Promise<{ data: Event[]; total: number }>
  getAttendingEvents(user: string): Promise<Event[]>
  createEvent(payload: CreateEventPayload, user: string): Promise<Event>
  updateEvent(id: string, patch: UpdateEventPayload, user: string): Promise<Event>
  deleteEvent(id: string, user: string, byAdmin: boolean): Promise<void>
}
