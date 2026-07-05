import SQL from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { CategoryScope, CategoryWithCount, ICategoriesRepository } from './types'

/**
 * Owns SQL for the `categories`, `place_categories` and `event_categories`
 * tables. Stateless; every method takes the db client so logic can pass the
 * pool or a transaction client.
 */
export function createCategoriesRepository(): ICategoriesRepository {
  async function findActivePlaceCategories(client: Queryable): Promise<string[]> {
    const result = await client.query<{ name: string }>(
      SQL`SELECT name FROM categories WHERE active IS true ORDER BY name`
    )
    return result.rows.map((row) => row.name)
  }

  async function findActivePlaceCategoriesWithCounts(
    client: Queryable,
    scope: CategoryScope = 'all'
  ): Promise<CategoryWithCount[]> {
    const query = SQL`
      SELECT c.name, count(pc.place_id) AS count
      FROM categories c
      LEFT JOIN place_categories pc ON pc.category_id = c.name
      LEFT JOIN places p ON pc.place_id = p.id AND p.disabled IS false
      WHERE c.active IS true`

    if (scope === 'worlds') {
      query.append(SQL` AND p.world IS true`)
    } else if (scope === 'places') {
      query.append(SQL` AND p.world IS false`)
    }

    query.append(SQL` GROUP BY c.name ORDER BY c.name`)

    const result = await client.query<{ name: string; count: string }>(query)
    return result.rows.map((row) => ({ name: row.name, count: Number(row.count) }))
  }

  async function findActiveEventCategories(client: Queryable): Promise<string[]> {
    const result = await client.query<{ name: string }>(
      SQL`SELECT name FROM event_categories WHERE active IS true ORDER BY name`
    )
    return result.rows.map((row) => row.name)
  }

  return {
    findActivePlaceCategories,
    findActivePlaceCategoriesWithCounts,
    findActiveEventCategories
  }
}
