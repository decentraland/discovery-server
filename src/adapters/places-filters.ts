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
