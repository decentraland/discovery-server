import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Destination } from '../../types/entities'
import type { OrderDirection, PlaceListOrderBy } from '../../adapters/places-repository'
import { multiParam as multi, intParam, positionsParam } from './query-params'

const MAP_MAX_LIMIT = 500
const ORDER_BY_VALUES: PlaceListOrderBy[] = ['like_score', 'updated_at', 'created_at', 'most_active']

function parseOrderBy(params: URLSearchParams): PlaceListOrderBy | undefined {
  const value = params.get('order_by') ?? undefined
  return ORDER_BY_VALUES.includes(value as PlaceListOrderBy) ? (value as PlaceListOrderBy) : undefined
}
const parseOrder = (params: URLSearchParams): OrderDirection => (params.get('order') === 'asc' ? 'asc' : 'desc')

type MapPlace = {
  id: string
  base_position: string
  title: string | null
  description: string | null
  image: string | null
  contact_name: string | null
  categories: string[]
  user_favorite: boolean
  user_like: boolean
  user_dislike: boolean
  user_count: number
  user_visits: number
}

/**
 * Legacy `GET /api/map` — genesis-city places keyed by base position (the map feed).
 * A thin per-place projection with realtime `user_count` (hot-scenes) and 30-day
 * `user_visits` (scene-stats). `user_visits` is 0 until the scene-stats adapter is wired.
 */
export async function getMapHandler(
  context: Pick<HandlerContextWithPath<'places', '/api/map'>, 'components' | 'url' | 'verification'>
): Promise<HTTPResponse<Record<string, MapPlace>>> {
  const { places } = context.components
  const params = context.url.searchParams
  const user = context.verification?.auth?.toLowerCase()

  const { data, total } = await places.getPlaces({
    positions: positionsParam(params),
    categories: multi(params, 'categories'),
    search: params.get('search') ?? undefined,
    only_favorites: params.get('only_favorites') === 'true',
    only_highlighted: params.get('only_highlighted') === 'true',
    order_by: parseOrderBy(params),
    order: parseOrder(params),
    limit: Math.min(intParam(params, 'limit') ?? MAP_MAX_LIMIT, MAP_MAX_LIMIT),
    offset: intParam(params, 'offset'),
    user
  })

  const map: Record<string, MapPlace> = {}
  for (const place of data) {
    map[place.base_position] = {
      id: place.id,
      base_position: place.base_position,
      title: place.title,
      description: place.description,
      image: place.image,
      contact_name: place.contact_name,
      categories: place.categories ?? [],
      user_favorite: place.user_favorite,
      user_like: place.user_like,
      user_dislike: place.user_dislike,
      user_count: place.user_count ?? 0,
      user_visits: place.user_visits ?? 0
    }
  }

  // `total` is the full match count from the component (may exceed the returned page), not data.length.
  return { status: 200, body: { ok: true, data: map, total } }
}

/**
 * Legacy `GET /api/map/places` — the unified places+worlds list for the map, with
 * realtime connected-user counts. Backed by the destinations UNION feed.
 */
export async function getMapPlacesHandler(
  context: Pick<HandlerContextWithPath<'destinations', '/api/map/places'>, 'components' | 'url' | 'verification'>
): Promise<HTTPResponse<Destination[]>> {
  const { destinations } = context.components
  const params = context.url.searchParams
  const user = context.verification?.auth?.toLowerCase()

  const orderBy = parseOrderBy(params)
  const { data, total } = await destinations.getDestinations(
    {
      positions: positionsParam(params),
      worldNames: multi(params, 'names') ?? multi(params, 'world_names'),
      categories: multi(params, 'categories'),
      search: params.get('search') ?? undefined,
      only_favorites: params.get('only_favorites') === 'true',
      only_highlighted: params.get('only_highlighted') === 'true',
      owner: params.get('owner') ?? undefined,
      creator_address: params.get('creator_address') ?? undefined,
      sdk: params.get('sdk') ?? undefined,
      // most_active isn't a destinations sort key (deferred); fall back to the default there.
      order_by: orderBy === 'most_active' ? undefined : orderBy,
      order: parseOrder(params),
      limit: Math.min(intParam(params, 'limit') ?? MAP_MAX_LIMIT, MAP_MAX_LIMIT),
      offset: intParam(params, 'offset'),
      user
    },
    { withConnectedUsers: true }
  )

  return { status: 200, body: { ok: true, data, total } }
}
