import SQL, { SQLStatement } from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { AggregateWorld, World } from '../../types/entities'
import type { IWorldsRepository, UpsertWorldInput, WorldListFilters, WorldListOrderBy } from './types'

const MAX_LIMIT = 100
// Columns `upsert` will update on conflict (identifiers are safe to inline).
const UPSERT_UPDATABLE_COLUMNS: Array<keyof UpsertWorldInput> = [
  'world_name',
  'title',
  'description',
  'image',
  'content_rating',
  'categories',
  'owner',
  'show_in_places',
  'single_player',
  'skybox_time',
  'is_private',
  'highlighted',
  'highlighted_image'
]

const ORDER_COLUMNS: Record<WorldListOrderBy, string> = {
  like_score: 'like_score',
  updated_at: 'updated_at',
  created_at: 'created_at',
  most_active: 'like_score'
}

/**
 * Owns SQL for the `worlds` table. A lateral join to the latest enabled place
 * with a matching world_id supplies contact/creator/sdk/deployed_at (the worlds
 * table itself does not store those). Per-user flags via LEFT JOINs on the
 * world id. Search matches `world_name` (worlds have no tsvector column).
 */
export function createWorldsRepository(): IWorldsRepository {
  const LATERAL_JOIN = SQL`
    LEFT JOIN LATERAL (
      SELECT p.contact_name, p.contact_email, p.creator_address, p.sdk, p.deployed_at
      FROM places p
      WHERE p.world_id = w.id AND p.disabled IS false
      ORDER BY p.deployed_at DESC
      LIMIT 1
    ) lp ON true`

  const LATERAL_COLUMNS = SQL`, lp.contact_name, lp.contact_email, lp.creator_address, lp.sdk, lp.deployed_at`

  function buildWhere(filters: WorldListFilters): SQLStatement {
    const where = SQL`w.show_in_places IS true`
    if (filters.only_highlighted) {
      where.append(SQL` AND w.highlighted = true`)
    }
    if (filters.search) {
      where.append(SQL` AND w.world_name ILIKE ${'%' + filters.search.toLowerCase() + '%'}`)
    }
    if (filters.names?.length) {
      const lowered = filters.names.map((n) => n.toLowerCase())
      where.append(SQL` AND w.id = ANY(${lowered})`)
    }
    if (filters.categories?.length) {
      where.append(SQL` AND w.categories && ${filters.categories}::varchar[]`)
    }
    if (filters.owner) {
      where.append(SQL` AND lower(w.owner) = ${filters.owner.toLowerCase()}`)
    }
    if (filters.only_favorites && filters.user) {
      where.append(SQL` AND EXISTS (
        SELECT 1 FROM user_favorites uf WHERE uf.entity_id = w.id AND uf."user" = ${filters.user.toLowerCase()}
      )`)
    }
    return where
  }

  function userFlagsSelect(user?: string): SQLStatement {
    if (!user) return SQL`, false AS user_favorite, false AS user_like, false AS user_dislike`
    return SQL`, uf."user" IS NOT NULL AS user_favorite,
      coalesce(ul."like", false) AS user_like,
      NOT coalesce(ul."like", true) AS user_dislike`
  }

  function userFlagsJoin(user?: string): SQLStatement {
    if (!user) return SQL``
    const wallet = user.toLowerCase()
    return SQL`
      LEFT JOIN user_favorites uf ON uf.entity_id = w.id AND uf."user" = ${wallet}
      LEFT JOIN user_likes ul ON ul.entity_id = w.id AND ul."user" = ${wallet}`
  }

  async function findByIdWithAggregates(client: Queryable, id: string, user?: string): Promise<AggregateWorld | null> {
    const query = SQL`SELECT w.*`
    query.append(LATERAL_COLUMNS).append(userFlagsSelect(user))
    query
      .append(SQL` FROM worlds w`)
      .append(LATERAL_JOIN)
      .append(userFlagsJoin(user))
    query.append(SQL` WHERE w.id = ${id.toLowerCase()}`)

    const result = await client.query<AggregateWorld>(query)
    return result.rows[0] ?? null
  }

  async function findWithAggregates(client: Queryable, filters: WorldListFilters): Promise<AggregateWorld[]> {
    const orderBy = ORDER_COLUMNS[filters.order_by ?? 'like_score']
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC'
    const limit = Math.min(filters.limit ?? 50, MAX_LIMIT)
    const offset = Math.max(filters.offset ?? 0, 0)

    const query = SQL`SELECT w.*`
    query.append(LATERAL_COLUMNS).append(userFlagsSelect(filters.user))
    query
      .append(SQL` FROM worlds w`)
      .append(LATERAL_JOIN)
      .append(userFlagsJoin(filters.user))
    query.append(SQL` WHERE `).append(buildWhere(filters))
    query.append(` ORDER BY w.${orderBy} ${direction} NULLS LAST, w.world_name ASC`)
    query.append(SQL` LIMIT ${limit} OFFSET ${offset}`)

    const result = await client.query<AggregateWorld>(query)
    return result.rows
  }

  async function count(client: Queryable, filters: WorldListFilters): Promise<number> {
    const query = SQL`SELECT count(DISTINCT w.id) AS total FROM worlds w WHERE `
    query.append(buildWhere(filters))
    const result = await client.query<{ total: string }>(query)
    return Number(result.rows[0]?.total ?? 0)
  }

  async function findNames(client: Queryable): Promise<string[]> {
    const result = await client.query<{ world_name: string }>(
      SQL`SELECT world_name FROM worlds WHERE show_in_places IS true ORDER BY world_name ASC`
    )
    return result.rows.map((row) => row.world_name)
  }

  async function upsert(client: Queryable, input: UpsertWorldInput): Promise<World> {
    // On conflict only the fields explicitly provided (and not undefined) are
    // updated, so an ingestion event that omits a field (e.g. owner on a
    // settings-changed) never clobbers the stored value with a default.
    const query = SQL`
      INSERT INTO worlds (id, world_name, title, description, image, content_rating, categories, owner,
                          show_in_places, single_player, skybox_time, is_private, highlighted, highlighted_image)
      VALUES (${input.id.toLowerCase()}, ${input.world_name}, ${input.title ?? null}, ${input.description ?? null},
              ${input.image ?? null}, ${input.content_rating ?? 'RP'}, ${input.categories ?? []}, ${input.owner ?? null},
              ${input.show_in_places ?? true}, ${input.single_player ?? false}, ${input.skybox_time ?? null},
              ${input.is_private ?? false}, ${input.highlighted ?? false}, ${input.highlighted_image ?? null})
      ON CONFLICT (id) DO UPDATE SET updated_at = now()`
    for (const column of UPSERT_UPDATABLE_COLUMNS) {
      // An absent key reads as undefined too, so the undefined check alone is sufficient.
      if (input[column] !== undefined) {
        query.append(`, "${column}" = `).append(SQL`${input[column] as unknown}`)
      }
    }
    query.append(SQL` RETURNING *`)
    const result = await client.query<World>(query)
    return result.rows[0]
  }

  async function updateModeration(
    client: Queryable,
    id: string,
    fields: import('./types').WorldModerationFields
  ): Promise<World | null> {
    const query = SQL`UPDATE worlds SET updated_at = now()`
    if (fields.content_rating !== undefined) query.append(SQL`, content_rating = ${fields.content_rating}`)
    if (fields.highlighted !== undefined) query.append(SQL`, highlighted = ${fields.highlighted}`)
    if (fields.highlighted_image !== undefined) query.append(SQL`, highlighted_image = ${fields.highlighted_image}`)
    if (fields.ranking !== undefined) query.append(SQL`, ranking = ${fields.ranking}`)
    query.append(SQL` WHERE id = ${id.toLowerCase()} RETURNING *`)

    const result = await client.query<World>(query)
    return result.rows[0] ?? null
  }

  return { findByIdWithAggregates, findWithAggregates, count, findNames, upsert, updateModeration }
}
