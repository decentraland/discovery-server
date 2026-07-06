import type { AppComponents } from '../../types'
import type { CategoryScope } from '../../adapters/categories-repository'
import { placeCategoriesI18n } from '../../intl/categories'
import type { ICategoriesComponent, PlaceCategoryView } from './types'

/**
 * Category listing plus the daily POI sync. Counts come from the categories
 * repository (decorated with English labels); syncPois reconciles the `poi`
 * category from the dcl-lists positions in a single transaction.
 */
export async function createCategoriesComponent(
  components: Pick<AppComponents, 'pg' | 'categoriesRepository' | 'dclListsClient' | 'logs'>
): Promise<ICategoriesComponent> {
  const { pg, categoriesRepository, dclListsClient } = components

  async function getPlaceCategories(scope: CategoryScope = 'all'): Promise<PlaceCategoryView[]> {
    const categories = await categoriesRepository.findActivePlaceCategoriesWithCounts(pg, scope)
    return categories.map((category) => ({
      ...category,
      i18n: { en: placeCategoriesI18n[category.name] ?? category.name }
    }))
  }

  async function getEventCategories(): Promise<string[]> {
    return categoriesRepository.findActiveEventCategories(pg)
  }

  async function syncPois(): Promise<number> {
    const pois = await dclListsClient.getPois()
    // The dcl-lists client returns [] when unconfigured or on any fetch error.
    // Reconciling against an empty set would delete every POI assignment, so an
    // empty list is treated as "no data, no changes" rather than a full wipe.
    if (!pois.length) return 0
    return pg.withTransaction((tx) => categoriesRepository.reconcilePoiCategory(tx, pois))
  }

  return {
    getPlaceCategories,
    getEventCategories,
    syncPois
  }
}
