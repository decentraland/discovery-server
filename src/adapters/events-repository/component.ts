import SQL, { SQLStatement } from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { Event } from '../../types/entities'
import type { CreateEventRow, EventListFilters, IEventsRepository, UpdateEventRow } from './types'

const MAX_LIMIT = 100
const MIN_SEARCH_LENGTH = 2

// Whitelisted updatable columns (identifier is safe to inline; values parameterized).
const UPDATABLE_COLUMNS: Array<keyof UpdateEventRow> = [
  'name',
  'image',
  'image_vertical',
  'description',
  'start_at',
  'finish_at',
  'duration',
  'all_day',
  'next_start_at',
  'next_finish_at',
  'recurrent',
  'recurrent_frequency',
  'recurrent_setpos',
  'recurrent_monthday',
  'recurrent_weekday_mask',
  'recurrent_month_mask',
  'recurrent_interval',
  'recurrent_count',
  'recurrent_until',
  'recurrent_dates',
  'x',
  'y',
  'server',
  'world',
  'estate_id',
  'estate_name',
  'scene_name',
  'place_id',
  'world_id',
  'community_id',
  'url',
  'user_name',
  'contact',
  'details',
  'approved',
  'rejected',
  'approved_by',
  'rejected_by',
  'rejection_reason',
  'highlighted',
  'total_attendees',
  'latest_attendees',
  'categories',
  'schedules',
  'deleted_by_user',
  'deleted_by_admin',
  'deleted_by',
  'deleted_at',
  'deleted_reason'
]

/** Owns SQL for the `events` table. */
export function createEventsRepository(): IEventsRepository {
  function buildWhere(filters: EventListFilters): SQLStatement {
    const where = SQL`TRUE`
    if (!filters.includeDeleted) {
      where.append(SQL` AND e.deleted_at IS NULL`)
    }
    if (!filters.includeUnapproved) {
      where.append(SQL` AND e.approved IS true AND e.rejected IS false`)
    }
    if (filters.search && filters.search.length >= MIN_SEARCH_LENGTH) {
      where.append(SQL` AND e.textsearch @@ websearch_to_tsquery('english', ${filters.search})`)
    }
    if (filters.placeIds?.length) {
      where.append(SQL` AND e.place_id = ANY(${filters.placeIds}::uuid[])`)
    }
    if (filters.worldNames?.length) {
      where.append(SQL` AND e.world_id = ANY(${filters.worldNames.map((n) => n.toLowerCase())})`)
    }
    if (filters.communityId) {
      where.append(SQL` AND e.community_id = ${filters.communityId}`)
    }
    if (filters.creator) {
      where.append(SQL` AND e."user" = ${filters.creator.toLowerCase()}`)
    }
    if (filters.attendee) {
      where.append(SQL` AND EXISTS (
        SELECT 1 FROM event_attendees a WHERE a.event_id = e.id AND a."user" = ${filters.attendee.toLowerCase()}
      )`)
    }
    if (filters.list === 'live') {
      where.append(SQL` AND e.next_start_at <= now() AND e.next_finish_at >= now()`)
    } else if (filters.list === 'upcoming') {
      where.append(SQL` AND e.next_start_at > now()`)
    }
    return where
  }

  async function create(client: Queryable, row: CreateEventRow): Promise<Event> {
    const result = await client.query<Event>(SQL`
      INSERT INTO events (
        name, image, image_vertical, description, start_at, finish_at, duration, all_day,
        next_start_at, next_finish_at, recurrent, recurrent_frequency, recurrent_setpos, recurrent_monthday,
        recurrent_weekday_mask, recurrent_month_mask, recurrent_interval, recurrent_count, recurrent_until,
        recurrent_dates, x, y, server, world, estate_id, estate_name, scene_name, place_id, world_id,
        community_id, url, "user", user_name, contact, details, approved, rejected, approved_by, rejected_by,
        rejection_reason, highlighted, total_attendees, latest_attendees, categories, schedules
      ) VALUES (
        ${row.name}, ${row.image}, ${row.image_vertical}, ${row.description}, ${row.start_at}, ${row.finish_at},
        ${row.duration}, ${row.all_day}, ${row.next_start_at}, ${row.next_finish_at}, ${row.recurrent},
        ${row.recurrent_frequency}, ${row.recurrent_setpos}, ${row.recurrent_monthday}, ${row.recurrent_weekday_mask},
        ${row.recurrent_month_mask}, ${row.recurrent_interval}, ${row.recurrent_count}, ${row.recurrent_until},
        ${row.recurrent_dates}, ${row.x}, ${row.y}, ${row.server}, ${row.world}, ${row.estate_id}, ${row.estate_name},
        ${row.scene_name}, ${row.place_id}, ${row.world_id}, ${row.community_id}, ${row.url}, ${row.user.toLowerCase()},
        ${row.user_name}, ${row.contact}, ${row.details}, ${row.approved}, ${row.rejected}, ${row.approved_by},
        ${row.rejected_by}, ${row.rejection_reason}, ${row.highlighted}, ${row.total_attendees},
        ${row.latest_attendees}, ${row.categories}, ${row.schedules}
      )
      RETURNING *`)
    return result.rows[0]
  }

  async function findById(client: Queryable, id: string): Promise<Event | null> {
    const result = await client.query<Event>(SQL`SELECT * FROM events WHERE id = ${id}`)
    return result.rows[0] ?? null
  }

  async function update(client: Queryable, id: string, patch: UpdateEventRow): Promise<Event | null> {
    const query = SQL`UPDATE events SET updated_at = now()`
    for (const column of UPDATABLE_COLUMNS) {
      if (column in patch) {
        query.append(`, "${column}" = `).append(SQL`${patch[column] as unknown}`)
      }
    }
    query.append(SQL` WHERE id = ${id} RETURNING *`)
    const result = await client.query<Event>(query)
    return result.rows[0] ?? null
  }

  async function list(client: Queryable, filters: EventListFilters): Promise<Event[]> {
    if (filters.search && filters.search.length < MIN_SEARCH_LENGTH) return []
    const limit = Math.min(filters.limit ?? 50, MAX_LIMIT)
    const offset = Math.max(filters.offset ?? 0, 0)

    const query = SQL`SELECT e.* FROM events e WHERE `
    query.append(buildWhere(filters))
    query.append(SQL` ORDER BY e.next_start_at ASC NULLS LAST LIMIT ${limit} OFFSET ${offset}`)
    const result = await client.query<Event>(query)
    return result.rows
  }

  async function count(client: Queryable, filters: EventListFilters): Promise<number> {
    if (filters.search && filters.search.length < MIN_SEARCH_LENGTH) return 0
    const query = SQL`SELECT count(*) AS total FROM events e WHERE `
    query.append(buildWhere(filters))
    const result = await client.query<{ total: string }>(query)
    return Number(result.rows[0]?.total ?? 0)
  }

  async function listAttending(client: Queryable, user: string): Promise<Event[]> {
    return list(client, { attendee: user, list: 'all' })
  }

  async function getLiveEntityIds(client: Queryable): Promise<{ placeIds: string[]; worldIds: string[] }> {
    const result = await client.query<{ place_id: string | null; world_id: string | null }>(SQL`
      SELECT DISTINCT place_id, world_id FROM events
      WHERE approved IS true AND deleted_at IS NULL
        AND next_start_at <= now() AND next_finish_at >= now()`)
    const placeIds = result.rows.map((r) => r.place_id).filter((id): id is string => !!id)
    const worldIds = result.rows.map((r) => r.world_id).filter((id): id is string => !!id)
    return { placeIds, worldIds }
  }

  async function findRecurrentNeedingUpdate(client: Queryable, limit: number): Promise<Event[]> {
    const result = await client.query<Event>(SQL`
      SELECT * FROM events
      WHERE recurrent IS true
        AND deleted_at IS NULL
        AND finish_at > now()
        AND (next_finish_at IS NULL OR next_finish_at <= now())
      ORDER BY next_finish_at ASC NULLS FIRST
      LIMIT ${limit}`)
    return result.rows
  }

  return { create, findById, update, list, count, listAttending, getLiveEntityIds, findRecurrentNeedingUpdate }
}
