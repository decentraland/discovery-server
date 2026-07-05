import SQL, { SQLStatement } from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { Destination } from '../../types/entities'
import type { DestinationListFilters, DestinationOrderBy, IDestinationsRepository } from './types'

const MAX_LIMIT = 100
const MIN_SEARCH_LENGTH = 3
const ORDER_COLUMNS: Record<DestinationOrderBy, string> = {
  like_score: 'like_score',
  updated_at: 'updated_at',
  created_at: 'created_at'
}

type Branch = 'place' | 'world'

/**
 * Owns the UNION query that projects `places` and `worlds` onto the common
 * `Destination` shape for the unified discovery surface. Per-user like/favorite
 * flags are computed per branch (entity_id is the place uuid-as-text or the
 * world id). Live-event decoration is added by the destinations logic.
 */
export function createDestinationsRepository(): IDestinationsRepository {
  function wants(filters: DestinationListFilters, branch: Branch): boolean {
    if (!filters.kinds?.length) return true
    return filters.kinds.includes(branch)
  }

  // A branch is excluded entirely (AND FALSE) when a filter targets the other kind.
  function branchExclusions(filters: DestinationListFilters, branch: Branch): boolean {
    if (branch === 'world' && filters.positions?.length) return true
    if (branch === 'place' && filters.worldNames?.length) return true
    return false
  }

  // alias ('p'|'w') and idExpr ('p.id::text'|'w.id') are code-controlled constants,
  // safe to inline as raw text; only the wallet value is parameterized.
  function userFlags(alias: string, idExpr: string, user?: string): { select: SQLStatement; joins: SQLStatement } {
    if (!user) {
      return { select: SQL`, false AS user_favorite, false AS user_like, false AS user_dislike`, joins: SQL`` }
    }
    const wallet = user.toLowerCase()
    const select = SQL``.append(
      `, uf_${alias}."user" IS NOT NULL AS user_favorite,` +
        ` coalesce(ul_${alias}."like", false) AS user_like,` +
        ` NOT coalesce(ul_${alias}."like", true) AS user_dislike`
    )
    const joins = SQL``
      .append(` LEFT JOIN user_favorites uf_${alias} ON uf_${alias}.entity_id = ${idExpr} AND uf_${alias}."user" = `)
      .append(SQL`${wallet}`)
      .append(` LEFT JOIN user_likes ul_${alias} ON ul_${alias}.entity_id = ${idExpr} AND ul_${alias}."user" = `)
      .append(SQL`${wallet}`)
    return { select, joins }
  }

  function placeBranch(filters: DestinationListFilters): SQLStatement {
    const flags = userFlags('p', 'p.id::text', filters.user)
    const query = SQL`SELECT p.id::text AS id, 'place'::text AS kind, p.title, p.description, p.image,
      p.base_position, p.world_name, p.categories, p.likes, p.dislikes, p.favorites, p.like_rate, p.like_score,
      p.highlighted, p.created_at, p.updated_at`
    query.append(flags.select)
    query.append(SQL` FROM places p`).append(flags.joins)
    query.append(SQL` WHERE p.disabled IS false AND p.world IS false`)
    if (branchExclusions(filters, 'place')) query.append(SQL` AND FALSE`)
    if (filters.only_highlighted) query.append(SQL` AND p.highlighted = true`)
    if (filters.search && filters.search.length >= MIN_SEARCH_LENGTH) {
      query.append(SQL` AND p.textsearch @@ websearch_to_tsquery('english', ${filters.search})`)
    }
    if (filters.categories?.length) query.append(SQL` AND p.categories && ${filters.categories}::varchar[]`)
    if (filters.ids?.length) query.append(SQL` AND p.id::text = ANY(${filters.ids})`)
    if (filters.positions?.length) {
      query.append(SQL` AND p.base_position IN (
        SELECT DISTINCT base_position FROM place_positions WHERE position = ANY(${filters.positions}::varchar[])
      )`)
    }
    return query
  }

  function worldBranch(filters: DestinationListFilters): SQLStatement {
    const flags = userFlags('w', 'w.id', filters.user)
    const query = SQL`SELECT w.id AS id, 'world'::text AS kind, w.title, w.description, w.image,
      NULL::varchar AS base_position, w.world_name, w.categories, w.likes, w.dislikes, w.favorites, w.like_rate,
      w.like_score, w.highlighted, w.created_at, w.updated_at`
    query.append(flags.select)
    query.append(SQL` FROM worlds w`).append(flags.joins)
    query.append(SQL` WHERE w.show_in_places IS true`)
    if (branchExclusions(filters, 'world')) query.append(SQL` AND FALSE`)
    if (filters.only_highlighted) query.append(SQL` AND w.highlighted = true`)
    if (filters.search && filters.search.length >= MIN_SEARCH_LENGTH) {
      query.append(SQL` AND w.world_name ILIKE ${'%' + filters.search.toLowerCase() + '%'}`)
    }
    if (filters.categories?.length) query.append(SQL` AND w.categories && ${filters.categories}::varchar[]`)
    if (filters.ids?.length) query.append(SQL` AND w.id = ANY(${filters.ids})`)
    if (filters.worldNames?.length)
      query.append(SQL` AND w.id = ANY(${filters.worldNames.map((n) => n.toLowerCase())})`)
    return query
  }

  function unionOf(filters: DestinationListFilters): SQLStatement | null {
    const branches: SQLStatement[] = []
    if (wants(filters, 'place')) branches.push(placeBranch(filters))
    if (wants(filters, 'world')) branches.push(worldBranch(filters))
    if (!branches.length) return null

    const union = SQL`(`.append(branches[0])
    for (let i = 1; i < branches.length; i++) {
      union.append(SQL`) UNION ALL (`).append(branches[i])
    }
    union.append(SQL`)`)
    return union
  }

  async function findWithAggregates(client: Queryable, filters: DestinationListFilters): Promise<Destination[]> {
    if (filters.search && filters.search.length < MIN_SEARCH_LENGTH) return []
    const union = unionOf(filters)
    if (!union) return []

    const orderBy = ORDER_COLUMNS[filters.order_by ?? 'like_score']
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC'
    const limit = Math.min(filters.limit ?? 50, MAX_LIMIT)
    const offset = Math.max(filters.offset ?? 0, 0)

    const query = SQL`SELECT * FROM (`.append(union).append(SQL`) AS destinations`)
    query.append(` ORDER BY ${orderBy} ${direction} NULLS LAST, updated_at DESC`)
    query.append(SQL` LIMIT ${limit} OFFSET ${offset}`)

    const result = await client.query<Destination>(query)
    return result.rows
  }

  async function count(client: Queryable, filters: DestinationListFilters): Promise<number> {
    if (filters.search && filters.search.length < MIN_SEARCH_LENGTH) return 0
    const union = unionOf(filters)
    if (!union) return 0

    const query = SQL`SELECT count(*) AS total FROM (`.append(union).append(SQL`) AS destinations`)
    const result = await client.query<{ total: string }>(query)
    return Number(result.rows[0]?.total ?? 0)
  }

  return { findWithAggregates, count }
}
