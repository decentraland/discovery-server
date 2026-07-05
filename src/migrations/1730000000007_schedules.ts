import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Curated event collections (renamed from the events repo's singular `schedule`
// table; the physical name is invisible to routes). Events reference these by the
// `events.schedules uuid[]` array.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE schedules (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name         varchar(50) NOT NULL,
      description  varchar(255),
      image        varchar(255),
      theme        varchar(25),
      background   varchar(30)[] NOT NULL DEFAULT '{}',
      active       boolean NOT NULL DEFAULT false,
      active_since timestamptz NOT NULL DEFAULT now(),
      active_until timestamptz NOT NULL DEFAULT now(),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX schedules_active_until_idx ON schedules (active_until);
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS schedules')
}
