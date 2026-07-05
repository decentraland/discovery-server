import type { AppComponents } from '../../types'
import type { CategoryScope } from '../../adapters/categories-repository'
import { placeCategoriesI18n } from '../../intl/categories'
import type { ICategoriesComponent, PlaceCategoryView } from './types'

/**
 * Category listing. Reads counts via the categories repository and decorates
 * place/world categories with their English labels. (The daily POI-sync job that
 * also lives in this domain is wired in a later phase.)
 */
export async function createCategoriesComponent(
  components: Pick<AppComponents, 'pg' | 'categoriesRepository' | 'logs'>
): Promise<ICategoriesComponent> {
  const { pg, categoriesRepository } = components

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

  return {
    getPlaceCategories,
    getEventCategories
  }
}
