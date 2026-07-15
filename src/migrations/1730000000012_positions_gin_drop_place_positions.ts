import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Position filtering now reads the denormalized `places.positions` array directly (via the
// `&&` overlap operator), so the separate `place_positions` pivot is no longer used. This
// forward-only, idempotent migration adds the GIN index backing that filter and drops the
// pivot — it is a no-op on a fresh DB (the pivot was never created) and repairs any env that
// had already applied the earlier baseline.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS places_positions_gin_idx ON places USING gin (positions);
    DROP TABLE IF EXISTS place_positions;
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS places_positions_gin_idx')
}
