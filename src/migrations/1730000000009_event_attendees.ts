import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Event attendance. Composite PK (one row per user per event). FK cascade to
// events is new (same-DB now). events.total_attendees / latest_attendees are
// denormalized from this table by the attendees logic in one transaction.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE event_attendees (
      event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      "user"     text NOT NULL,
      user_name  text,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (event_id, "user")
    );
    CREATE INDEX event_attendees_user_idx ON event_attendees ("user");
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS event_attendees')
}
