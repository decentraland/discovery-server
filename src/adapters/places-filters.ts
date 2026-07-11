import SQL, { SQLStatement } from 'sql-template-strings'

/**
 * Shared WHERE-clause fragments for filtering the `places` table (alias `p`), used by
 * both the places repository and the destinations UNION so these filters have a single
 * source of truth and can't drift apart. Values are parameterized; the `p` alias is a
 * fixed, code-controlled constant.
 */

/** Category-array overlap (a place in any of the given categories). */
export function placesCategoriesClause(categories: string[]): SQLStatement {
  return SQL` AND p.categories && ${categories}::varchar[]`
}

/** Parcel overlap (a place occupying any of the given "x,y" positions). */
export function placesPositionsClause(positions: string[]): SQLStatement {
  return SQL` AND p.positions && ${positions}::varchar[]`
}

/** Minimum search length; shorter queries return no matches (legacy parity). */
export const MIN_SEARCH_LENGTH = 3

/**
 * Build a prefix ts_query from a free-text search so partial words match (legacy used
 * pg-tsquery, which appends `:*` to every term). Strips punctuation, ANDs the terms:
 * "dec ar" -> "dec:* & ar:*". Empty (junk-only input) yields '' so the caller can
 * short-circuit to no matches instead of a `to_tsquery('')` syntax error.
 */
export function toPrefixTsQuery(search: string): string {
  return search
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `${term}:*`)
    .join(' & ')
}
