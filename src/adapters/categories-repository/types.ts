import type { Queryable } from '../pg'

export type CategoryScope = 'all' | 'places' | 'worlds'

export type CategoryWithCount = {
  name: string
  count: number
}

export interface ICategoriesRepository {
  /** Active place/world category names. */
  findActivePlaceCategories(client: Queryable): Promise<string[]>
  /**
   * Active place/world categories with the count of matching (non-disabled)
   * entities, optionally scoped to only places or only worlds. Mirrors the
   * legacy `CategoryModel.findActiveCategoriesWithPlaces`.
   */
  findActivePlaceCategoriesWithCounts(client: Queryable, scope?: CategoryScope): Promise<CategoryWithCount[]>
  /** Active event category (tag) names. */
  findActiveEventCategories(client: Queryable): Promise<string[]>
}
