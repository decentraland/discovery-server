import SQL, { SQLStatement } from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { Destination } from '../../types/entities'
import { placesCategoriesClause, placesPositionsClause, toPrefixTsQuery, MIN_SEARCH_LENGTH } from '../places-filters'
import type { DestinationListFilters, DestinationOrderBy, IDestinationsRepository } from './types'

const MAX_LIMIT = 100

// Latest enabled place for a world — supplies the contact/creator/sdk/deployed_at/image the
// worlds table doesn't store (mirrors the worlds repository lateral join).
const WORLD_LATERAL = SQL`
  LEFT JOIN LATERAL (
    SELECT p.image, p.contact_name, p.contact_email, p.creator_address, p.sdk, p.deployed_at
    FROM places p WHERE p.world_id = w.id AND p.disabled IS false
    ORDER BY p.deployed_at DESC LIMIT 1
  ) lp ON true`

const WORLD_TEXTSEARCH = SQL`(
  setweight(to_tsvector('english', coalesce(w.title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(w.world_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(w.description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(w.owner, '')), 'C'))`

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

  // A branch is excluded only when a kind-specific filter targets the OTHER kind
  // and nothing targets this one. When both positions and world_names are supplied
  // (e.g. a mixed by-ids batch), each branch keeps the rows its own filter matches.
  function branchExclusions(filters: DestinationListFilters, branch: Branch): boolean {
    if (branch === 'world' && filters.positions?.length && !filters.worldNames?.length) return true
    if (branch === 'place' && filters.worldNames?.length && !filters.positions?.length) return true
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
    const query = SQL`SELECT p.id::text AS id, 'place'::text AS kind, false AS world, p.title, p.description, p.image,
      p.base_position, p.positions, p.world_name, p.owner, p.content_rating, p.categories,
      p.likes, p.dislikes, p.favorites, p.like_rate, p.like_score, p.highlighted, p.highlighted_image,
      p.ranking, false AS disabled, false AS is_private, p.contact_name, p.contact_email,
      p.creator_address, p.sdk, p.deployed_at, p.created_at, p.updated_at`
    query.append(flags.select)
    query.append(SQL` FROM places p`).append(flags.joins)
    query.append(SQL` WHERE p.disabled IS false AND p.world IS false`)
    if (branchExclusions(filters, 'place')) query.append(SQL` AND FALSE`)
    if (filters.only_highlighted) query.append(SQL` AND p.highlighted = true`)
    if (filters.search && filters.search.length >= MIN_SEARCH_LENGTH) {
      const q = toPrefixTsQuery(filters.search)
      query.append(q ? SQL` AND p.textsearch @@ to_tsquery('english', ${q})` : SQL` AND FALSE`)
    }
    if (filters.categories?.length) query.append(placesCategoriesClause(filters.categories))
    if (filters.ids?.length) query.append(SQL` AND p.id::text = ANY(${filters.ids.map((id) => id.toLowerCase())})`)
    if (filters.positions?.length) query.append(placesPositionsClause(filters.positions))
    if (filters.creator_address)
      query.append(SQL` AND lower(p.creator_address) = ${filters.creator_address.toLowerCase()}`)
    if (filters.sdk) {
      query.append(SQL` AND (p.sdk = ${filters.sdk} OR p.sdk LIKE ${filters.sdk + '.%'}`)
      if (filters.sdk === '6') query.append(SQL` OR p.sdk IS NULL`)
      query.append(SQL`)`)
    }
    if (filters.owner) {
      query.append(
        filters.operatedPositions?.length
          ? SQL` AND (lower(p.owner) = ${filters.owner.toLowerCase()} OR p.positions && ${filters.operatedPositions}::varchar[])`
          : SQL` AND lower(p.owner) = ${filters.owner.toLowerCase()}`
      )
    }
    // only_favorites reuses the favorites LEFT JOIN (present only when a user is set).
    if (filters.only_favorites && filters.user) query.append(SQL` AND uf_p."user" IS NOT NULL`)
    return query
  }

  function worldBranch(filters: DestinationListFilters): SQLStatement {
    const flags = userFlags('w', 'w.id', filters.user)
    const query = SQL`SELECT w.id AS id, 'world'::text AS kind, true AS world, w.title, w.description,
      COALESCE(w.image, lp.image) AS image, '0,0'::varchar AS base_position, '{}'::varchar[] AS positions,
      w.world_name, w.owner, w.content_rating, w.categories, w.likes, w.dislikes, w.favorites, w.like_rate,
      w.like_score, w.highlighted, w.highlighted_image, w.ranking, false AS disabled, w.is_private,
      lp.contact_name, lp.contact_email, lp.creator_address, lp.sdk, lp.deployed_at, w.created_at, w.updated_at`
    query.append(flags.select)
    query
      .append(SQL` FROM worlds w`)
      .append(WORLD_LATERAL)
      .append(flags.joins)
    query.append(SQL` WHERE w.show_in_places IS true`)
    // Worlds with no enabled place are hidden from the open list (legacy parity), but an explicit
    // by-id / by-name lookup still resolves them.
    if (!filters.ids?.length && !filters.worldNames?.length) {
      query.append(SQL` AND EXISTS (SELECT 1 FROM places p WHERE p.world_id = w.id AND p.disabled IS false)`)
    }
    if (branchExclusions(filters, 'world')) query.append(SQL` AND FALSE`)
    // sdk/creator_address filters target genesis scenes; a world branch never matches them.
    if (filters.creator_address || filters.sdk) query.append(SQL` AND FALSE`)
    if (filters.only_highlighted) query.append(SQL` AND w.highlighted = true`)
    if (filters.search && filters.search.length >= MIN_SEARCH_LENGTH) {
      const q = toPrefixTsQuery(filters.search)
      query.append(q ? SQL` AND ${WORLD_TEXTSEARCH} @@ to_tsquery('english', ${q})` : SQL` AND FALSE`)
    }
    if (filters.categories?.length) query.append(SQL` AND w.categories && ${filters.categories}::varchar[]`)
    if (filters.ids?.length) query.append(SQL` AND w.id = ANY(${filters.ids.map((id) => id.toLowerCase())})`)
    if (filters.worldNames?.length)
      query.append(SQL` AND w.id = ANY(${filters.worldNames.map((n) => n.toLowerCase())})`)
    if (filters.owner) query.append(SQL` AND lower(w.owner) = ${filters.owner.toLowerCase()}`)
    if (filters.only_favorites && filters.user) query.append(SQL` AND uf_w."user" IS NOT NULL`)
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
    // Legacy floats highlighted then higher-ranked destinations to the top before order_by.
    query.append(
      ` ORDER BY highlighted DESC, ranking DESC NULLS LAST, ${orderBy} ${direction} NULLS LAST, updated_at DESC`
    )
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
