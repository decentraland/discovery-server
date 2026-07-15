import type { Queryable } from '../pg'

export type NotificationCursor = {
  id: string
  last_successful_run_at: number | null
}

export interface INotificationCursorsRepository {
  /** The last successful run timestamp (epoch ms) for a notification type, if any. */
  get(client: Queryable, id: string): Promise<NotificationCursor | null>
  /** Advance the cursor for a notification type to the given epoch-ms timestamp. */
  set(client: Queryable, id: string, lastSuccessfulRunAt: number): Promise<void>
}
