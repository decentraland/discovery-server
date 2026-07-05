import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Catalog seeds so a fresh dev/test DB is self-sufficient. Idempotent
// (ON CONFLICT DO NOTHING) so the ETL can upsert prod data over them harmlessly.
// Schedules are NOT seeded here — they are prod data carried by the ETL.

// Place/world taxonomy (INITIAL_CATEGORIES from places + parkour; `ads` was removed).
const PLACE_CATEGORIES = [
  'poi',
  'featured',
  'game',
  'casino',
  'social',
  'music',
  'art',
  'fashion',
  'crypto',
  'education',
  'shop',
  'sports',
  'business',
  'parkour'
]

// Event tags (the 25 seeded in the events service).
const EVENT_CATEGORIES = [
  'art',
  'causes',
  'competition',
  'education',
  'gambling',
  'gaming',
  'giveaway',
  'health',
  'hobbies',
  'identity',
  'live',
  'music',
  'networking',
  'nft',
  'other',
  'party',
  'play',
  'poap',
  'religion',
  'shopping',
  'social',
  'sports',
  'talks',
  'town',
  'tv'
]

export async function up(pgm: MigrationBuilder): Promise<void> {
  const placeValues = PLACE_CATEGORIES.map((name) => `('${name}', true)`).join(', ')
  const eventValues = EVENT_CATEGORIES.map((name) => `('${name}', true)`).join(', ')

  pgm.sql(`INSERT INTO categories (name, active) VALUES ${placeValues} ON CONFLICT (name) DO NOTHING`)
  pgm.sql(`INSERT INTO event_categories (name, active) VALUES ${eventValues} ON CONFLICT (name) DO NOTHING`)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  const placeNames = PLACE_CATEGORIES.map((name) => `'${name}'`).join(', ')
  const eventNames = EVENT_CATEGORIES.map((name) => `'${name}'`).join(', ')

  pgm.sql(`DELETE FROM categories WHERE name IN (${placeNames})`)
  pgm.sql(`DELETE FROM event_categories WHERE name IN (${eventNames})`)
}
