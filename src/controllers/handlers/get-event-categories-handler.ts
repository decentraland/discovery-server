import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { EventCategoryView } from '../../logic/categories'

/** Legacy `GET /api/events/categories` — active event categories with metadata + i18n labels. */
export async function getEventCategoriesHandler(
  context: Pick<HandlerContextWithPath<'categories', '/api/events/categories'>, 'components'>
): Promise<HTTPResponse<EventCategoryView[]>> {
  const { categories } = context.components

  const data = await categories.getEventCategories()

  return { status: 200, body: { ok: true, data } }
}
