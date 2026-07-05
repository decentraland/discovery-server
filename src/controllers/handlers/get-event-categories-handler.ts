import type { HandlerContextWithPath, HTTPResponse } from '../../types'

/** Legacy `GET /api/events/categories` — active event category (tag) names. */
export async function getEventCategoriesHandler(
  context: Pick<HandlerContextWithPath<'categories', '/api/events/categories'>, 'components'>
): Promise<HTTPResponse<string[]>> {
  const { categories } = context.components

  const data = await categories.getEventCategories()

  return { status: 200, body: { ok: true, data } }
}
