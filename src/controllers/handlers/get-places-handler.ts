import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { AggregatePlace, PlaceStatus } from '../../types/entities'
import type { OrderDirection, PlaceListFilters, PlaceListOrderBy } from '../../adapters/places-repository'
import { BadRequestError } from '../../types/errors'
import { multiParam as multi, intParam, positionsParam } from './query-params'

// Legacy hard-caps a by-ids batch at 100 (rejecting more), unlike the 1000-item unified cap.
const PLACES_MAX_IDS = 100

const ORDER_BY_VALUES: PlaceListOrderBy[] = ['like_score', 'updated_at', 'created_at', 'most_active']

function parseFilters(params: URLSearchParams, user?: string): PlaceListFilters {
  const orderByParam = params.get('order_by') ?? undefined
  const orderBy = ORDER_BY_VALUES.includes(orderByParam as PlaceListOrderBy)
    ? (orderByParam as PlaceListOrderBy)
    : undefined
  return {
    search: params.get('search') ?? undefined,
    positions: positionsParam(params),
    categories: multi(params, 'categories'),
    names: multi(params, 'names'),
    only_highlighted: params.get('only_highlighted') === 'true',
    only_favorites: params.get('only_favorites') === 'true',
    owner: params.get('owner') ?? undefined,
    creator_address: params.get('creator_address') ?? undefined,
    sdk: params.get('sdk') ?? undefined,
    order_by: orderBy,
    order: params.get('order') === 'asc' ? 'asc' : ('desc' as OrderDirection),
    limit: intParam(params, 'limit'),
    offset: intParam(params, 'offset'),
    user
  }
}

/** Legacy `GET /api/places` — filtered, paginated place list. */
export async function getPlaceListHandler(
  context: Pick<HandlerContextWithPath<'places', '/api/places'>, 'components' | 'url' | 'verification'>
): Promise<HTTPResponse<AggregatePlace[]>> {
  const { places } = context.components
  const user = context.verification?.auth?.toLowerCase()

  const { data, total } = await places.getPlaces(parseFilters(context.url.searchParams, user))

  return { status: 200, body: { ok: true, data, total } }
}

/** Legacy `GET /api/places/:place_id` — a single place with aggregates. */
export async function getPlaceHandler(
  context: Pick<HandlerContextWithPath<'places', '/api/places/:place_id'>, 'components' | 'params' | 'verification'>
): Promise<HTTPResponse<AggregatePlace>> {
  const { places } = context.components
  const user = context.verification?.auth?.toLowerCase()

  const data = await places.getPlace(context.params.place_id, user)

  return { status: 200, body: { ok: true, data } }
}

/**
 * Legacy `GET /api/places/:place_id/categories` — the place's category slugs, read from the
 * authoritative `place_categories` join. A valid-uuid-but-unknown place returns `{ categories: [] }`
 * (200), matching legacy; only a malformed id is rejected.
 */
export async function getPlaceCategoriesHandler(
  context: Pick<HandlerContextWithPath<'places', '/api/places/:place_id/categories'>, 'components' | 'params'>
): Promise<HTTPResponse<{ categories: string[] }>> {
  const { places } = context.components

  const categories = await places.getPlaceCategories(context.params.place_id)

  return { status: 200, body: { ok: true, data: { categories } } }
}

async function readIds(context: { request: { json: () => Promise<unknown> } }): Promise<string[]> {
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }
  const ids = Array.isArray(body) ? body : (body as { ids?: unknown })?.ids
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new BadRequestError('Body must be an array of ids or { ids: string[] }')
  }
  if (ids.length > PLACES_MAX_IDS) {
    throw new BadRequestError(`Too many ids (max ${PLACES_MAX_IDS})`)
  }
  return ids as string[]
}

/** Legacy `POST /api/places` — places by an array of ids (list filters apply from the query string). */
export async function getPlaceListByIdHandler(
  context: Pick<HandlerContextWithPath<'places', '/api/places'>, 'components' | 'request' | 'url' | 'verification'>
): Promise<HTTPResponse<AggregatePlace[]>> {
  const { places } = context.components
  const user = context.verification?.auth?.toLowerCase()

  const ids = await readIds(context)
  const { data, total } = await places.getPlacesByIds(ids, parseFilters(context.url.searchParams, user))

  return { status: 200, body: { ok: true, data, total } }
}

/** Legacy `POST /api/places/status` — raw status rows by id (no aggregates). */
export async function getPlaceStatusListHandler(
  context: Pick<HandlerContextWithPath<'places', '/api/places/status'>, 'components' | 'request'>
): Promise<HTTPResponse<PlaceStatus[]>> {
  const { places } = context.components

  const ids = await readIds(context)
  const data = await places.getPlacesStatus(ids)

  return { status: 200, body: { ok: true, data, total: data.length } }
}
