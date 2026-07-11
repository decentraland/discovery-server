import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Destination } from '../../types/entities'
import type {
  DestinationKind,
  DestinationListFilters,
  DestinationOrderBy
} from '../../adapters/destinations-repository'
import { BadRequestError } from '../../types/errors'
import { multiParam as multi, intParam, parseWithOptions, positionsParam, MAX_BATCH_ITEMS } from './query-params'

/** A body array of strings, capped to guard against giant `ANY(...)` scans; undefined if absent. */
function boundedList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length > MAX_BATCH_ITEMS) throw new BadRequestError(`Too many items (max ${MAX_BATCH_ITEMS})`)
  return value.filter((item): item is string => typeof item === 'string')
}

const ORDER_BY_VALUES: DestinationOrderBy[] = ['like_score', 'updated_at', 'created_at']
const KIND_VALUES: DestinationKind[] = ['place', 'world']

function parseFilters(params: URLSearchParams, user?: string): DestinationListFilters {
  const orderByParam = params.get('order_by') ?? undefined
  let kinds = multi(params, 'kinds')?.filter((k): k is DestinationKind => KIND_VALUES.includes(k as DestinationKind))
  // Legacy only_worlds / only_places narrow the kind set (mapped onto the `kinds` filter).
  if (params.get('only_worlds') === 'true') kinds = ['world']
  else if (params.get('only_places') === 'true') kinds = ['place']
  // Legacy calls the position filter `pointer`; accept it as an alias of `positions`.
  const positions = positionsParam(params) ?? multi(params, 'pointer')
  return {
    search: params.get('search') ?? undefined,
    categories: multi(params, 'categories'),
    positions,
    worldNames: multi(params, 'world_names') ?? multi(params, 'names'),
    // by-ids lookup (folded in from the old POST batch endpoint)
    ids: multi(params, 'ids'),
    only_highlighted: params.get('only_highlighted') === 'true',
    only_favorites: params.get('only_favorites') === 'true',
    owner: params.get('owner') ?? undefined,
    creator_address: params.get('creator_address') ?? undefined,
    sdk: params.get('sdk') ?? undefined,
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

  let raw: unknown = {}
  try {
    raw = await context.request.json()
  } catch {
    // tolerate an empty body
  }
  // Legacy POST /api/destinations sends a bare JSON array of ids; newer callers send an object.
  const body = (Array.isArray(raw) ? { ids: raw } : (raw ?? {})) as {
    ids?: unknown
    positions?: unknown
    world_names?: unknown
  }
  const ids = boundedList(body.ids)
  const positions = boundedList(body.positions)
  const worldNames = boundedList(body.world_names)

  // This is a by-id lookup: if the caller provided selectors but none survived validation,
  // the answer is "nothing matches" — don't fall through to the full unfiltered list.
  const provided = Array.isArray(body.ids) || Array.isArray(body.positions) || Array.isArray(body.world_names)
  if (provided && !ids?.length && !positions?.length && !worldNames?.length) {
    return { status: 200, body: { ok: true, data: [], total: 0 } }
  }

  const { data, total } = await destinations.getDestinations(
    { ids, positions, worldNames, user, limit: 100 },
    parseWithOptions(context.url.searchParams)
  )

  return { status: 200, body: { ok: true, data, total } }
}
