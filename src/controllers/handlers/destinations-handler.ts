import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Destination } from '../../types/entities'
import type {
  DestinationKind,
  DestinationListFilters,
  DestinationOrderBy
} from '../../adapters/destinations-repository'
import { multiParam as multi, intParam, parseWithOptions } from './query-params'

const ORDER_BY_VALUES: DestinationOrderBy[] = ['like_score', 'updated_at', 'created_at']
const KIND_VALUES: DestinationKind[] = ['place', 'world']

function parseFilters(params: URLSearchParams, user?: string): DestinationListFilters {
  const orderByParam = params.get('order_by') ?? undefined
  const kinds = multi(params, 'kinds')?.filter((k): k is DestinationKind => KIND_VALUES.includes(k as DestinationKind))
  // positions are "x,y" tokens — use getAll so the comma isn't split.
  const positions = params.getAll('positions').filter(Boolean)
  return {
    search: params.get('search') ?? undefined,
    categories: multi(params, 'categories'),
    positions: positions.length ? positions : undefined,
    worldNames: multi(params, 'world_names') ?? multi(params, 'names'),
    // by-ids lookup (folded in from the old POST batch endpoint)
    ids: multi(params, 'ids'),
    only_highlighted: params.get('only_highlighted') === 'true',
    only_favorites: params.get('only_favorites') === 'true',
    owner: params.get('owner') ?? undefined,
    kinds: kinds?.length ? kinds : undefined,
    order_by: ORDER_BY_VALUES.includes(orderByParam as DestinationOrderBy)
      ? (orderByParam as DestinationOrderBy)
      : undefined,
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    limit: intParam(params, 'limit'),
    offset: intParam(params, 'offset'),
    user
  }
}

/** Legacy `GET /api/destinations` and new `GET /v1/destinations` — unified places+worlds. */
export async function getDestinationsListHandler(
  context: Pick<HandlerContextWithPath<'destinations', '/api/destinations'>, 'components' | 'url' | 'verification'>
): Promise<HTTPResponse<Destination[]>> {
  const { destinations } = context.components
  const params = context.url.searchParams
  const user = context.verification?.auth?.toLowerCase()

  const { data, total } = await destinations.getDestinations(parseFilters(params, user), parseWithOptions(params))

  return { status: 200, body: { ok: true, data, total } }
}

/** Legacy `POST /api/destinations` and new `POST /v1/destinations/batch` — by ids. */
export async function getDestinationsByIdHandler(
  context: Pick<
    HandlerContextWithPath<'destinations', '/api/destinations'>,
    'components' | 'url' | 'request' | 'verification'
  >
): Promise<HTTPResponse<Destination[]>> {
  const { destinations } = context.components
  const user = context.verification?.auth?.toLowerCase()

  let body: { ids?: unknown; positions?: unknown; world_names?: unknown } = {}
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    // tolerate an empty body
  }
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : undefined
  const positions = Array.isArray(body.positions) ? (body.positions as string[]) : undefined
  const worldNames = Array.isArray(body.world_names) ? (body.world_names as string[]) : undefined

  const { data, total } = await destinations.getDestinations(
    { ids, positions, worldNames, user, limit: 100 },
    parseWithOptions(context.url.searchParams)
  )

  return { status: 200, body: { ok: true, data, total } }
}
