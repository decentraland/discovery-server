import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { CategoryScope } from '../../adapters/categories-repository'
import type { PlaceCategoryView } from '../../logic/categories'

/** Legacy `GET /api/categories` — active place/world categories with counts + i18n. */
export async function getCategoriesHandler(
  context: Pick<HandlerContextWithPath<'categories', '/api/categories'>, 'components' | 'url'>
): Promise<HTTPResponse<PlaceCategoryView[]>> {
  const { categories } = context.components
  const params = context.url.searchParams

  // Accept the legacy `target=places|worlds` param as well as only_places/only_worlds.
  const target = params.get('target')
  const scope: CategoryScope =
    target === 'worlds' || params.get('only_worlds') === 'true'
      ? 'worlds'
      : target === 'places' || params.get('only_places') === 'true'
        ? 'places'
        : 'all'

  const data = await categories.getPlaceCategories(scope)

  return { status: 200, body: { ok: true, data } }
}
