import type { Queryable } from '../pg'
import type { Event } from '../../types/entities'

export type EventListFilters = {
  search?: string
  /** Include pending/rejected events (admin view). Default false = only approved. */
  includeUnapproved?: boolean
  /** Include soft-deleted events. Default false. */
  includeDeleted?: boolean
  placeIds?: string[]
  worldNames?: string[]
  communityId?: string
  creator?: string
  /** Only events the given user is attending. */
  attendee?: string
  /** live = happening now; upcoming = future; all = both (by next_start_at). */
  list?: 'live' | 'upcoming' | 'all'
  limit?: number
  offset?: number
}

/**
 * Columns supplied when inserting an event (Date-based). id/timestamps are
 * DB-generated and the soft-delete columns default (an event is never created
 * deleted).
 */
export type CreateEventRow = Omit<
  Event,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'deleted_by_user'
  | 'deleted_by_admin'
  | 'deleted_by'
  | 'deleted_at'
  | 'deleted_reason'
>

export type UpdateEventRow = Partial<Omit<Event, 'id' | 'created_at' | 'updated_at' | 'user'>>

export interface IEventsRepository {
  create(client: Queryable, row: CreateEventRow): Promise<Event>
  findById(client: Queryable, id: string): Promise<Event | null>
  update(client: Queryable, id: string, patch: UpdateEventRow): Promise<Event | null>
  list(client: Queryable, filters: EventListFilters): Promise<Event[]>
  count(client: Queryable, filters: EventListFilters): Promise<number>
  /** Events the user is attending (approved, non-deleted). */
  listAttending(client: Queryable, user: string): Promise<Event[]>
  /** Distinct place/world ids that currently have a live (approved, ongoing) event. */
  getLiveEntityIds(client: Queryable): Promise<{ placeIds: string[]; worldIds: string[] }>
  /** Recurrent, non-deleted events whose tracked next occurrence has passed but whose rule still has future dates. */
  findRecurrentNeedingUpdate(client: Queryable, limit: number): Promise<Event[]>
}
