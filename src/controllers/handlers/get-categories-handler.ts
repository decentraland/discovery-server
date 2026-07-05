import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { CategoryScope } from '../../adapters/categories-repository'
import type { PlaceCategoryView } from '../../logic/categories'

/** Legacy `GET /api/categories` — active place/world categories with counts + i18n. */
export async function getCategoriesHandler(
  context: Pick<HandlerContextWithPath<'categories', '/api/categories'>, 'components' | 'url'>
): Promise<HTTPResponse<PlaceCategoryView[]>> {
  const { categories } = context.components
  const params = context.url.searchParams

  const scope: CategoryScope =
    params.get('only_worlds') === 'true' ? 'worlds' : params.get('only_places') === 'true' ? 'places' : 'all'

  const data = await categories.getPlaceCategories(scope)

  return { status: 200, body: { ok: true, data } }
}
