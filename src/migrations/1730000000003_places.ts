import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Places catalog. Genesis City scenes, plus legacy world rows (world = true) that
// remain load-bearing: the world detail/list queries read image/contact/sdk/deployed_at
// from the latest enabled place with a matching world_id (see the (world_id, deployed_at)
// index below). `id` normalized to native uuid (was CHAR(36) under gatsby).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE places (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title             varchar(50),
      description       text,
      image             text,
      owner             text,
      creator_address   text,
      positions         varchar(15)[] NOT NULL DEFAULT '{}',
      base_position     varchar(15) NOT NULL,
      contact_name      text,
      contact_email     text,
      content_rating    varchar(4) NOT NULL DEFAULT 'PR',
      likes             integer NOT NULL DEFAULT 0,
      dislikes          integer NOT NULL DEFAULT 0,
      favorites         integer NOT NULL DEFAULT 0,
      like_rate         real DEFAULT 0,
      like_score        real,
      ranking           double precision DEFAULT 0,
      highlighted       boolean NOT NULL DEFAULT false,
      highlighted_image text,
      disabled          boolean NOT NULL DEFAULT false,
      disabled_at       timestamptz,
      disabled_reason   varchar(20),
      world             boolean NOT NULL DEFAULT false,
      world_name        text,
      world_id          text REFERENCES worlds(id) ON DELETE SET NULL,
      deployed_at       timestamptz NOT NULL DEFAULT now(),
      textsearch        tsvector,
      categories        varchar(50)[] NOT NULL DEFAULT '{}',
      sdk               varchar(50),
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX places_base_position_idx ON places (base_position) WHERE disabled IS FALSE AND world IS FALSE;
    CREATE INDEX places_updated_at_idx    ON places (updated_at)    WHERE disabled IS FALSE AND world IS FALSE;
    CREATE INDEX places_like_rate_idx     ON places (like_rate)     WHERE disabled IS FALSE AND world IS FALSE;
    CREATE INDEX places_like_score_idx    ON places (like_score DESC NULLS LAST) WHERE disabled IS FALSE AND world IS FALSE;
    CREATE INDEX places_ranking_idx       ON places (ranking)       WHERE disabled IS FALSE;
    CREATE INDEX places_sdk_idx           ON places (sdk)           WHERE disabled IS FALSE;
    CREATE INDEX places_creator_address_idx ON places (creator_address);
    CREATE INDEX places_world_name_lower_idx ON places (lower(world_name)) WHERE world IS TRUE;
    CREATE INDEX places_world_id_idx      ON places (world_id) WHERE world_id IS NOT NULL;
    CREATE INDEX places_world_id_deployed_at_idx ON places (world_id, deployed_at DESC)
      WHERE disabled IS FALSE AND world_id IS NOT NULL;
    CREATE INDEX places_categories_gin_idx ON places USING gin (categories);
    CREATE INDEX places_textsearch_idx    ON places USING gin (textsearch);
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS places')
}
