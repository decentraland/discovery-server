import SQL from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { EventAttendee } from '../../types/entities'
import type { IAttendeesRepository } from './types'

const LATEST_ATTENDEES_LIMIT = 10

/** Owns SQL for the `event_attendees` table + the denormalized counters on `events`. */
export function createAttendeesRepository(): IAttendeesRepository {
  async function add(client: Queryable, eventId: string, user: string, userName: string | null): Promise<void> {
    await client.query(SQL`
      INSERT INTO event_attendees (event_id, "user", user_name)
      VALUES (${eventId}, ${user.toLowerCase()}, ${userName})
      ON CONFLICT (event_id, "user") DO UPDATE SET user_name = EXCLUDED.user_name`)
  }

  async function remove(client: Queryable, eventId: string, user: string): Promise<void> {
    await client.query(SQL`DELETE FROM event_attendees WHERE event_id = ${eventId} AND "user" = ${user.toLowerCase()}`)
  }

  async function listByEvent(client: Queryable, eventId: string): Promise<EventAttendee[]> {
    const result = await client.query<EventAttendee>(
      SQL`SELECT * FROM event_attendees WHERE event_id = ${eventId} ORDER BY created_at DESC`
    )
    return result.rows
  }

  async function listAttendedEventIds(client: Queryable, user: string, eventIds: string[]): Promise<string[]> {
    if (!eventIds.length) return []
    const result = await client.query<{ event_id: string }>(SQL`
      SELECT event_id FROM event_attendees
      WHERE "user" = ${user.toLowerCase()} AND event_id = ANY(${eventIds}::uuid[])`)
    return result.rows.map((row) => row.event_id)
  }

  async function isAttending(client: Queryable, eventId: string, user: string): Promise<boolean> {
    const result = await client.query(
      SQL`SELECT 1 FROM event_attendees WHERE event_id = ${eventId} AND "user" = ${user.toLowerCase()}`
    )
    return (result.rowCount ?? 0) > 0
  }

  async function lockEvent(client: Queryable, eventId: string): Promise<void> {
    await client.query(SQL`SELECT 1 FROM events WHERE id = ${eventId} FOR UPDATE`)
  }

  async function recomputeCounters(client: Queryable, eventId: string): Promise<void> {
    await client.query(SQL`
      WITH counted AS (
        SELECT count(*) AS total FROM event_attendees WHERE event_id = ${eventId}
      ),
      latest AS (
        SELECT coalesce(array_agg("user" ORDER BY created_at DESC), '{}') AS users
        FROM (
          SELECT "user", created_at FROM event_attendees
          WHERE event_id = ${eventId}
          ORDER BY created_at DESC
          LIMIT ${LATEST_ATTENDEES_LIMIT}
        ) t
      )
      UPDATE events
      SET total_attendees = counted.total, latest_attendees = latest.users
      FROM counted, latest
      WHERE events.id = ${eventId}`)
  }

  return { add, remove, listByEvent, listAttendedEventIds, isAttending, lockEvent, recomputeCounters }
}
