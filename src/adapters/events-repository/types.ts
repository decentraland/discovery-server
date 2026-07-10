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
  /** `"x,y"` base positions; matches events by their (x, y) coordinate. */
  positions?: string[]
  communityId?: string
  creator?: string
  /** Only events the given user is attending. */
  attendee?: string
  /** All of a wallet's own events across every status (approved/pending/rejected). */
  ownedBy?: string
  /** The requesting wallet: their own pending/rejected events remain visible to them. */
  viewer?: string
  /** live = happening now; upcoming = future; active = not yet finished; all = no time filter. */
  list?: 'live' | 'upcoming' | 'active' | 'all'
  /** Only highlighted events. */
  highlighted?: boolean
  /** true = worlds only, false = non-worlds only, undefined = both. */
  world?: boolean
  /** Only events referencing this schedule (collection) id. */
  schedule?: string
  estateId?: string
  /** next_start_at >= from (ISO). */
  from?: string
  /** next_start_at < to (ISO). */
  to?: string
  /** Sort direction on next_start_at (default asc). */
  order?: 'asc' | 'desc'
  /** Admin-only precise moderation selectors (tri-state). */
  approved?: boolean
  rejected?: boolean
  deleted?: boolean
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
  /** The earliest upcoming approved event per place/world id, as a global map (for the live-events cache). */
  getAllNextEvents(client: Queryable): Promise<Record<string, { id: string; name: string; next_start_at: string }>>
  /** Recurrent, non-deleted events whose tracked next occurrence has passed but whose rule still has future dates. */
  findRecurrentNeedingUpdate(client: Queryable, limit: number): Promise<Event[]>
  /** Approved, non-deleted events whose next_start_at falls in (since, until] (epoch ms). */
  findInStartWindow(client: Queryable, sinceMs: number, untilMs: number): Promise<Event[]>
  /** Approved, non-deleted events whose next_finish_at falls in (since, until] (epoch ms). */
  findInFinishWindow(client: Queryable, sinceMs: number, untilMs: number): Promise<Event[]>
}
