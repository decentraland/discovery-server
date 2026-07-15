import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Events. The legacy polymorphic `place_id TEXT` is split into a real
// `place_id uuid FK -> places` (genesis events) and `world_id text FK -> worlds`
// (world events), both ON DELETE SET NULL so an admin hard-delete of a junk
// place/world can never brick event writes and events degrade gracefully (the
// legacy API serves COALESCE(place_id::text, world_id) for the `place_id` field).
// Dropped vs legacy: coordinates (x/y are canonical), trending (vestigial),
// previous_place_id (rollback scaffolding). `duration` stays integer (ms).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE events (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name                   text NOT NULL,
      image                  text,
      image_vertical         text,
      description            text,
      start_at               timestamptz NOT NULL,
      finish_at              timestamptz NOT NULL,
      duration               integer NOT NULL DEFAULT 0,
      all_day                boolean NOT NULL DEFAULT false,
      next_start_at          timestamptz,
      next_finish_at         timestamptz,
      recurrent              boolean NOT NULL DEFAULT false,
      recurrent_frequency    text,
      recurrent_setpos       integer,
      recurrent_monthday     integer,
      recurrent_weekday_mask integer NOT NULL DEFAULT 0,
      recurrent_month_mask   integer NOT NULL DEFAULT 0,
      recurrent_interval     integer NOT NULL DEFAULT 1,
      recurrent_count        integer,
      recurrent_until        timestamptz,
      recurrent_dates        timestamptz[] NOT NULL DEFAULT '{}',
      x                      integer DEFAULT 0,
      y                      integer DEFAULT 0,
      server                 text,
      world                  boolean NOT NULL DEFAULT false,
      estate_id              text,
      estate_name            text,
      scene_name             text,
      place_id               uuid REFERENCES places(id) ON DELETE SET NULL,
      world_id               text REFERENCES worlds(id) ON DELETE SET NULL,
      community_id           text,
      url                    text,
      "user"                 text NOT NULL,
      user_name              text,
      contact                text,
      details                text,
      approved               boolean NOT NULL DEFAULT false,
      rejected               boolean NOT NULL DEFAULT false,
      approved_by            text,
      rejected_by            text,
      rejection_reason       text,
      highlighted            boolean NOT NULL DEFAULT false,
      total_attendees        integer NOT NULL DEFAULT 0,
      latest_attendees       text[] NOT NULL DEFAULT '{}',
      categories             varchar(50)[] NOT NULL DEFAULT '{}',
      schedules              uuid[] NOT NULL DEFAULT '{}',
      textsearch             tsvector,
      deleted_by_user        boolean NOT NULL DEFAULT false,
      deleted_by_admin       boolean NOT NULL DEFAULT false,
      deleted_by             text,
      deleted_at             timestamptz,
      deleted_reason         text,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT events_world_ref CHECK (NOT world OR place_id IS NULL)
    );

    CREATE INDEX events_next_start_at_idx ON events (next_start_at);
    CREATE INDEX events_approved_created_at_idx ON events (approved, created_at);
    CREATE INDEX events_rejected_approved_user_next_finish_idx ON events (rejected, approved, "user", next_finish_at);
    CREATE INDEX events_world_created_at_idx ON events (world, created_at);
    CREATE INDEX events_place_id_idx ON events (place_id);
    CREATE INDEX events_world_id_idx ON events (world_id);
    CREATE INDEX events_community_id_idx ON events (community_id);
    CREATE INDEX events_categories_gin_idx ON events USING gin (categories);
    CREATE INDEX events_textsearch_idx ON events USING gin (textsearch);
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS events')
}
