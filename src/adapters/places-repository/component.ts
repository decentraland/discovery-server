import SQL, { SQLStatement } from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { AggregatePlace, Place, PlaceStatus } from '../../types/entities'
import type { IPlacesRepository, PlaceListFilters, PlaceListOrderBy, UpsertPlaceInput } from './types'

const MIN_SEARCH_LENGTH = 3
const MAX_LIMIT = 100
const ORDER_COLUMNS: Record<PlaceListOrderBy, string> = {
  like_score: 'like_score',
  updated_at: 'updated_at',
  created_at: 'created_at'
}

/**
 * Owns SQL for the `places` table. Stored aggregate columns (likes/like_score/…)
 * are returned as-is; per-user like/favorite flags are computed via LEFT JOINs
 * when a wallet is supplied. Realtime user counts and Catalyst operated-lands are
 * decoration added by the places logic once those adapters exist — not gated here.
 */
export function createPlacesRepository(): IPlacesRepository {
  function buildWhere(filters: PlaceListFilters): SQLStatement {
    const where = SQL`p.disabled IS false`

    // Exclude legacy world rows unless the caller explicitly targets highlighted, ids, or names.
    if (!filters.only_highlighted && !filters.ids?.length && !filters.names?.length) {
      where.append(SQL` AND p.world IS false`)
    }
    if (filters.only_highlighted) {
      where.append(SQL` AND p.highlighted = true`)
    }
    if (filters.search && filters.search.length >= MIN_SEARCH_LENGTH) {
      where.append(SQL` AND p.textsearch @@ websearch_to_tsquery('english', ${filters.search})`)
    }
    if (filters.categories?.length) {
      where.append(SQL` AND p.categories && ${filters.categories}::varchar[]`)
    }
    if (filters.positions?.length && !filters.names?.length) {
      where.append(SQL` AND p.base_position IN (
        SELECT DISTINCT base_position FROM place_positions WHERE position = ANY(${filters.positions}::varchar[])
      )`)
    }
    if (filters.owner) {
      where.append(SQL` AND lower(p.owner) = ${filters.owner.toLowerCase()}`)
    }
    if (filters.creator_address) {
      where.append(SQL` AND lower(p.creator_address) = ${filters.creator_address.toLowerCase()}`)
    }
    if (filters.sdk) {
      where.append(SQL` AND (p.sdk = ${filters.sdk} OR p.sdk LIKE ${filters.sdk + '.%'}`)
      if (filters.sdk === '6') where.append(SQL` OR p.sdk IS NULL`)
      where.append(SQL`)`)
    }
    if (filters.ids?.length) {
      where.append(SQL` AND p.id = ANY(${filters.ids}::uuid[])`)
    }
    if (filters.names?.length) {
      where.append(SQL` AND p.world_id = ANY(${filters.names.map((n) => n.toLowerCase())})`)
    }
    if (filters.only_favorites && filters.user) {
      where.append(SQL` AND EXISTS (
        SELECT 1 FROM user_favorites uf WHERE uf.entity_id = p.id::text AND uf."user" = ${filters.user.toLowerCase()}
      )`)
    }
    return where
  }

  function userFlagsSelect(user?: string): SQLStatement {
    if (!user) {
      return SQL`, false AS user_favorite, false AS user_like, false AS user_dislike`
    }
    return SQL`, uf."user" IS NOT NULL AS user_favorite,
      coalesce(ul."like", false) AS user_like,
      NOT coalesce(ul."like", true) AS user_dislike`
  }

  function userFlagsJoin(user?: string): SQLStatement {
    if (!user) return SQL``
    const wallet = user.toLowerCase()
    return SQL`
      LEFT JOIN user_favorites uf ON uf.entity_id = p.id::text AND uf."user" = ${wallet}
      LEFT JOIN user_likes ul ON ul.entity_id = p.id::text AND ul."user" = ${wallet}`
  }

  async function findByIdWithAggregates(client: Queryable, id: string, user?: string): Promise<AggregatePlace | null> {
    const query = SQL`SELECT p.*`
    query.append(userFlagsSelect(user))
    query.append(SQL` FROM places p`)
    query.append(userFlagsJoin(user))
    query.append(SQL` WHERE p.id = ${id}`)

    const result = await client.query<AggregatePlace>(query)
    return result.rows[0] ?? null
  }

  async function findByIds(client: Queryable, ids: string[]): Promise<PlaceStatus[]> {
    if (!ids.length) return []
    const result = await client.query<PlaceStatus>(SQL`
      SELECT p.id, p.disabled, p.world, p.world_name, p.base_position
      FROM places p WHERE p.id = ANY(${ids}::uuid[])`)
    return result.rows
  }

  async function findWithAggregates(client: Queryable, filters: PlaceListFilters): Promise<AggregatePlace[]> {
    if (filters.search && filters.search.length < MIN_SEARCH_LENGTH) return []

    const orderBy = ORDER_COLUMNS[filters.order_by ?? 'like_score']
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC'
    const limit = Math.min(filters.limit ?? 50, MAX_LIMIT)
    const offset = Math.max(filters.offset ?? 0, 0)

    const query = SQL`SELECT p.*`
    query.append(userFlagsSelect(filters.user))
    if (filters.search && filters.search.length >= MIN_SEARCH_LENGTH) {
      query.append(SQL`, ts_rank_cd(p.textsearch, websearch_to_tsquery('english', ${filters.search})) AS rank`)
    }
    query.append(SQL` FROM places p`)
    query.append(userFlagsJoin(filters.user))
    query.append(SQL` WHERE `).append(buildWhere(filters))

    query.append(SQL` ORDER BY `)
    if (filters.search && filters.search.length >= MIN_SEARCH_LENGTH) query.append(SQL`rank DESC, `)
    // orderBy and direction are whitelisted above, so this is safe to append as raw text.
    query.append(` p.${orderBy} ${direction} NULLS LAST, p.deployed_at DESC`)
    query.append(SQL` LIMIT ${limit} OFFSET ${offset}`)

    const result = await client.query<AggregatePlace>(query)
    return result.rows
  }

  async function count(client: Queryable, filters: PlaceListFilters): Promise<number> {
    if (filters.search && filters.search.length < MIN_SEARCH_LENGTH) return 0
    const query = SQL`SELECT count(DISTINCT p.id) AS total FROM places p WHERE `
    query.append(buildWhere(filters))
    const result = await client.query<{ total: string }>(query)
    return Number(result.rows[0]?.total ?? 0)
  }

  async function insert(client: Queryable, input: UpsertPlaceInput): Promise<Place> {
    const result = await client.query<Place>(SQL`
      INSERT INTO places (
        id, title, description, image, owner, creator_address, positions, base_position,
        content_rating, world, world_name, world_id, categories, sdk, deployed_at, highlighted, disabled
      ) VALUES (
        COALESCE(${input.id ?? null}::uuid, gen_random_uuid()), ${input.title ?? null}, ${input.description ?? null}, ${input.image ?? null},
        ${input.owner ?? null}, ${input.creator_address ?? null}, ${input.positions ?? []},
        ${input.base_position}, ${input.content_rating ?? 'PR'}, ${input.world ?? false},
        ${input.world_name ?? null}, ${input.world_id ?? null}, ${input.categories ?? []}, ${input.sdk ?? null},
        ${input.deployed_at ?? new Date().toISOString()}, ${input.highlighted ?? false}, ${input.disabled ?? false}
      )
      RETURNING *`)
    return result.rows[0]
  }

  async function updateModeration(
    client: Queryable,
    id: string,
    fields: import('./types').PlaceModerationFields
  ): Promise<Place | null> {
    const query = SQL`UPDATE places SET updated_at = now()`
    if (fields.content_rating !== undefined) query.append(SQL`, content_rating = ${fields.content_rating}`)
    if (fields.highlighted !== undefined) query.append(SQL`, highlighted = ${fields.highlighted}`)
    if (fields.highlighted_image !== undefined) query.append(SQL`, highlighted_image = ${fields.highlighted_image}`)
    if (fields.ranking !== undefined) query.append(SQL`, ranking = ${fields.ranking}`)
    if (fields.disabled !== undefined) {
      query.append(SQL`, disabled = ${fields.disabled}`)
      query.append(fields.disabled ? SQL`, disabled_at = now()` : SQL`, disabled_at = NULL`)
    }
    if (fields.disabled_reason !== undefined) query.append(SQL`, disabled_reason = ${fields.disabled_reason}`)
    query.append(SQL` WHERE id = ${id} RETURNING *`)

    const result = await client.query<Place>(query)
    return result.rows[0] ?? null
  }

  return { findByIdWithAggregates, findByIds, findWithAggregates, count, insert, updateModeration }
}
