import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Two distinct catalogs: `categories` (place/world taxonomy, counted from the
// place_categories pivot) and `event_categories` (event tags). Their slug
// namespaces collide with different meanings and no query ever joins them, so
// they stay separate; a view exposes the union for the unified discovery layer.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE categories (
      name       varchar(50) PRIMARY KEY,
      active     boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE place_categories (
      place_id    uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      category_id varchar(50) NOT NULL REFERENCES categories(name) ON DELETE CASCADE,
      PRIMARY KEY (category_id, place_id)
    );
    CREATE INDEX place_categories_place_id_idx ON place_categories (place_id);

    CREATE TABLE event_categories (
      name       varchar(50) PRIMARY KEY,
      active     boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE VIEW discovery_categories AS
      SELECT name, 'place'::text AS scope, active FROM categories
      UNION ALL
      SELECT name, 'event'::text AS scope, active FROM event_categories;
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP VIEW IF EXISTS discovery_categories;
    DROP TABLE IF EXISTS place_categories;
    DROP TABLE IF EXISTS event_categories;
    DROP TABLE IF EXISTS categories;
  `)
}
