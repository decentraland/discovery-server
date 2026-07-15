import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Partial index backing the updateNextStartAt cron's `findRecurrentNeedingUpdate` query. It
// selects recurrent, non-rejected, non-deleted events ordered by next_finish_at; without this
// index the cron seq-scans and sorts the whole events table every minute. Forward-only and
// idempotent so it also applies to an already-migrated environment.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS events_recurrent_next_finish_idx
      ON events (next_finish_at NULLS FIRST)
      WHERE recurrent IS true AND rejected IS false AND deleted_at IS NULL
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS events_recurrent_next_finish_idx')
}
