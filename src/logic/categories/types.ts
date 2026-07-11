import type { CategoryScope, CategoryWithCount, EventCategory } from '../../adapters/categories-repository'

export type PlaceCategoryView = CategoryWithCount & {
  i18n: { en: string }
}

export type EventCategoryView = EventCategory & {
  i18n: { en: string }
}

export interface ICategoriesComponent {
  /** Active place/world categories with entity counts and English labels. */
  getPlaceCategories(scope?: CategoryScope): Promise<PlaceCategoryView[]>
  /** Active event categories (tags) with metadata and English labels. */
  getEventCategories(): Promise<EventCategoryView[]>
  /** Daily job: sync the `poi` category from dcl-lists. Returns the POI place count. */
  syncPois(): Promise<number>
}
