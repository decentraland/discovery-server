import type { CategoryScope, CategoryWithCount } from '../../adapters/categories-repository'

export type PlaceCategoryView = CategoryWithCount & {
  i18n: { en: string }
}

export interface ICategoriesComponent {
  /** Active place/world categories with entity counts and English labels. */
  getPlaceCategories(scope?: CategoryScope): Promise<PlaceCategoryView[]>
  /** Active event category (tag) names. */
  getEventCategories(): Promise<string[]>
  /** Daily job: sync the `poi` category from dcl-lists. Returns the POI place count. */
  syncPois(): Promise<number>
}
