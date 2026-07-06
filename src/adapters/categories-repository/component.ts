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
    // count(p.id) — not count(pc.place_id) — so disabled/scope-filtered places
    // are excluded from the count. The scope predicate lives in the JOIN (not
    // WHERE) so active categories with no matching entity still appear with 0.
    const query = SQL`
      SELECT c.name, count(p.id) AS count
      FROM categories c
      LEFT JOIN place_categories pc ON pc.category_id = c.name
      LEFT JOIN places p ON pc.place_id = p.id AND p.disabled IS false`

    if (scope === 'worlds') {
      query.append(SQL` AND p.world IS true`)
    } else if (scope === 'places') {
      query.append(SQL` AND p.world IS false`)
    }

    query.append(SQL` WHERE c.active IS true GROUP BY c.name ORDER BY c.name`)

    const result = await client.query<{ name: string; count: string }>(query)
    return result.rows.map((row) => ({ name: row.name, count: Number(row.count) }))
  }

  async function findActiveEventCategories(client: Queryable): Promise<string[]> {
    const result = await client.query<{ name: string }>(
      SQL`SELECT name FROM event_categories WHERE active IS true ORDER BY name`
    )
    return result.rows.map((row) => row.name)
  }

  async function reconcilePoiCategory(client: Queryable, basePositions: string[]): Promise<number> {
    const positions = basePositions.length ? basePositions : ['']
    // Target places: enabled genesis places at the POI positions.
    const target = await client.query<{ id: string }>(
      SQL`SELECT id FROM places WHERE base_position = ANY(${positions}::varchar[]) AND disabled IS false AND world IS false`
    )
    const ids = target.rows.map((r) => r.id)

    // Pivot: drop poi from non-target places, add it to target places.
    await client.query(
      SQL`DELETE FROM place_categories WHERE category_id = 'poi' AND NOT (place_id = ANY(${ids}::uuid[]))`
    )
    if (ids.length) {
      await client.query(SQL`
        INSERT INTO place_categories (category_id, place_id)
        SELECT 'poi', unnest(${ids}::uuid[]) ON CONFLICT DO NOTHING`)
    }

    // Denormalized array mirror on places.categories.
    await client.query(
      SQL`UPDATE places SET categories = array_remove(categories, 'poi')
          WHERE 'poi' = ANY(categories) AND NOT (id = ANY(${ids}::uuid[]))`
    )
    if (ids.length) {
      await client.query(
        SQL`UPDATE places SET categories = array_append(categories, 'poi')
            WHERE id = ANY(${ids}::uuid[]) AND NOT ('poi' = ANY(categories))`
      )
    }
    return ids.length
  }

  return {
    findActivePlaceCategories,
    findActivePlaceCategoriesWithCounts,
    findActiveEventCategories,
    reconcilePoiCategory
  }
}
