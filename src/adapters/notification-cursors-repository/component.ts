import SQL from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { INotificationCursorsRepository, NotificationCursor } from './types'

/** Owns SQL for the `notification_cursors` table (SNS cron idempotency). */
export function createNotificationCursorsRepository(): INotificationCursorsRepository {
  async function get(client: Queryable, id: string): Promise<NotificationCursor | null> {
    const result = await client.query<{ id: string; last_successful_run_at: string | null }>(
      SQL`SELECT id, last_successful_run_at FROM notification_cursors WHERE id = ${id}`
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      id: row.id,
      last_successful_run_at: row.last_successful_run_at === null ? null : Number(row.last_successful_run_at)
    }
  }

  async function set(client: Queryable, id: string, lastSuccessfulRunAt: number): Promise<void> {
    await client.query(SQL`
      INSERT INTO notification_cursors (id, last_successful_run_at, created_at, updated_at)
      VALUES (${id}, ${lastSuccessfulRunAt}, ${lastSuccessfulRunAt}, ${lastSuccessfulRunAt})
      ON CONFLICT (id) DO UPDATE SET last_successful_run_at = EXCLUDED.last_successful_run_at, updated_at = EXCLUDED.updated_at`)
  }

  return { get, set }
}
