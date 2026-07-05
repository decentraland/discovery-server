import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Likes/favorites are polymorphic on entity_id (place uuid-as-text | world id |
// future event uuid-as-text). `entity_type` makes the discriminator explicit so
// aggregates and the discovery layer never have to guess. No FK to three parents
// (matching today's behavior; parents are soft-deleted, never hard-deleted).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE user_likes (
      entity_id     text NOT NULL,
      entity_type   varchar(10) NOT NULL DEFAULT 'place',
      "user"        text NOT NULL,
      user_activity integer NOT NULL DEFAULT 0,
      "like"        boolean NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (entity_id, "user")
    );
    CREATE INDEX user_likes_entity_like_activity_idx ON user_likes (entity_id, "like", user_activity);
    CREATE INDEX user_likes_user_like_activity_idx   ON user_likes ("user", "like", user_activity);

    CREATE TABLE user_favorites (
      entity_id     text NOT NULL,
      entity_type   varchar(10) NOT NULL DEFAULT 'place',
      "user"        text NOT NULL,
      user_activity integer NOT NULL DEFAULT 0,
      created_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (entity_id, "user")
    );
    CREATE INDEX user_favorites_entity_activity_idx ON user_favorites (entity_id, user_activity);
    CREATE INDEX user_favorites_user_activity_idx   ON user_favorites ("user", user_activity);

    CREATE TABLE content_ratings (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id       text NOT NULL,
      original_rating varchar(4),
      update_rating   varchar(4) NOT NULL,
      moderator       text NOT NULL,
      comment         text,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX content_ratings_entity_created_idx ON content_ratings (entity_id, created_at);
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS content_ratings;
    DROP TABLE IF EXISTS user_favorites;
    DROP TABLE IF EXISTS user_likes;
  `)
}
