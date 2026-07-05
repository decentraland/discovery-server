import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Worlds catalog. `id` is the lowercased world_name (deterministic), so it can be
// referenced as a stable FK by places and events. Created before `places` so its
// world_id FK can reference it.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE worlds (
      id                text PRIMARY KEY,
      world_name        text NOT NULL UNIQUE,
      title             varchar(50),
      description       text,
      image             text,
      content_rating    text NOT NULL DEFAULT 'RP',
      categories        varchar(50)[] NOT NULL DEFAULT '{}',
      owner             text,
      show_in_places    boolean NOT NULL DEFAULT true,
      single_player     boolean NOT NULL DEFAULT false,
      skybox_time       integer,
      is_private        boolean NOT NULL DEFAULT false,
      likes             integer NOT NULL DEFAULT 0,
      dislikes          integer NOT NULL DEFAULT 0,
      favorites         integer NOT NULL DEFAULT 0,
      like_rate         real DEFAULT 0.5,
      like_score        real DEFAULT 0,
      highlighted       boolean NOT NULL DEFAULT false,
      highlighted_image text,
      ranking           double precision DEFAULT 0,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT worlds_id_lowercase CHECK (id = lower(id))
    );

    CREATE INDEX worlds_visible_idx    ON worlds (show_in_places) WHERE show_in_places IS TRUE;
    CREATE INDEX worlds_like_score_idx ON worlds (like_score)     WHERE show_in_places IS TRUE;
    CREATE INDEX worlds_ranking_idx    ON worlds (ranking)        WHERE show_in_places IS TRUE;
    CREATE INDEX worlds_categories_gin_idx ON worlds USING gin (categories);
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS worlds')
}
