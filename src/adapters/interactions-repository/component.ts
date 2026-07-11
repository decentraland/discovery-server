import SQL, { SQLStatement } from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { EntityType, IInteractionsRepository, SetFavoriteInput, SetLikeInput } from './types'

/** Likes/dislikes below this weighted activity are excluded from like_rate/like_score. */
export const MIN_USER_ACTIVITY = 100

// Entities whose own table carries denormalized interaction counters. Events store
// interactions but have no counter columns, so recompute is a no-op for them.
const COUNTER_TABLE: Partial<Record<EntityType, 'places' | 'worlds'>> = {
  place: 'places',
  world: 'worlds'
}

/**
 * Owns SQL for `user_likes` / `user_favorites` and the denormalized recompute on
 * the entity's own table. The Wilson-score lower-bound formula and VP-weighted
 * active-user counts are carried over verbatim from the legacy places service.
 */
export function createInteractionsRepository(): IInteractionsRepository {
  function entityIdMatch(entityType: EntityType, entityId: string): SQLStatement {
    // places.id is uuid; worlds.id is text. Cast only for places.
    return entityType === 'place' ? SQL`id = ${entityId}::uuid` : SQL`id = ${entityId}`
  }

  async function lockEntity(client: Queryable, entityType: EntityType, entityId: string): Promise<void> {
    const targetTable = COUNTER_TABLE[entityType]
    if (!targetTable) return
    const query = SQL`SELECT 1 FROM `
    query.append(targetTable)
    query
      .append(SQL` WHERE `)
      .append(entityIdMatch(entityType, entityId))
      .append(SQL` FOR UPDATE`)
    await client.query(query)
  }

  async function setLike(client: Queryable, input: SetLikeInput): Promise<void> {
    const user = input.user.toLowerCase()
    if (input.like === null) {
      await client.query(SQL`DELETE FROM user_likes WHERE entity_id = ${input.entityId} AND "user" = ${user}`)
      return
    }
    await client.query(SQL`
      INSERT INTO user_likes (entity_id, entity_type, "user", user_activity, "like")
      VALUES (${input.entityId}, ${input.entityType}, ${user}, ${input.userActivity}, ${input.like})
      ON CONFLICT (entity_id, "user") DO UPDATE
        SET "like" = EXCLUDED."like", user_activity = EXCLUDED.user_activity,
            entity_type = EXCLUDED.entity_type, updated_at = now()`)
  }

  async function setFavorite(client: Queryable, input: SetFavoriteInput): Promise<void> {
    const user = input.user.toLowerCase()
    if (!input.favorite) {
      await client.query(SQL`DELETE FROM user_favorites WHERE entity_id = ${input.entityId} AND "user" = ${user}`)
      return
    }
    await client.query(SQL`
      INSERT INTO user_favorites (entity_id, entity_type, "user", user_activity)
      VALUES (${input.entityId}, ${input.entityType}, ${user}, ${input.userActivity})
      ON CONFLICT (entity_id, "user") DO UPDATE
        SET user_activity = EXCLUDED.user_activity, entity_type = EXCLUDED.entity_type`)
  }

  async function recomputeLikes(client: Queryable, entityType: EntityType, entityId: string): Promise<void> {
    const targetTable = COUNTER_TABLE[entityType]
    if (!targetTable) return

    const query = SQL`
      WITH counted AS (
        SELECT
          count(*) filter (where "like") as count_likes,
          count(*) filter (where not "like") as count_dislikes,
          count(*) filter (where user_activity >= ${MIN_USER_ACTIVITY}) as count_active_total,
          count(*) filter (where "like" and user_activity >= ${MIN_USER_ACTIVITY}) as count_active_likes,
          count(*) filter (where not "like" and user_activity >= ${MIN_USER_ACTIVITY}) as count_active_dislikes
        FROM user_likes
        WHERE entity_id = ${entityId}
      )
      UPDATE `
    query.append(targetTable)
    query.append(SQL`
      SET
        likes = c.count_likes,
        dislikes = c.count_dislikes,
        like_rate = (CASE WHEN c.count_active_total::float = 0 THEN NULL
                          ELSE c.count_active_likes / c.count_active_total::float END),
        like_score = (CASE WHEN (c.count_active_likes + c.count_active_dislikes > 0) THEN
          ((c.count_active_likes + 1.9208)
          / (c.count_active_likes + c.count_active_dislikes) - 1.96
          * SQRT((c.count_active_likes * c.count_active_dislikes) / (c.count_active_likes + c.count_active_dislikes) + 0.9604)
          / (c.count_active_likes + c.count_active_dislikes))
          / (1 + 3.8416 / (c.count_active_likes + c.count_active_dislikes))
        ELSE NULL END)
      FROM counted c
      WHERE `)
    query.append(entityIdMatch(entityType, entityId))
    await client.query(query)
  }

  async function recomputeFavorites(client: Queryable, entityType: EntityType, entityId: string): Promise<void> {
    const targetTable = COUNTER_TABLE[entityType]
    if (!targetTable) return

    const query = SQL`
      WITH counted AS (
        SELECT count(*) AS count FROM user_favorites WHERE entity_id = ${entityId}
      )
      UPDATE `
    query.append(targetTable)
    query.append(SQL` SET favorites = c.count FROM counted c WHERE `)
    query.append(entityIdMatch(entityType, entityId))
    await client.query(query)
  }

  return { lockEntity, setLike, setFavorite, recomputeLikes, recomputeFavorites }
}
