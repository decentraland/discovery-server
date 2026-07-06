import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { AggregateWorld } from '../../types/entities'
import type { OrderDirection, WorldListFilters, WorldListOrderBy } from '../../adapters/worlds-repository'
import { multiParam as multi } from './query-params'

const ORDER_BY_VALUES: WorldListOrderBy[] = ['like_score', 'updated_at', 'created_at']

function parseFilters(params: URLSearchParams, user?: string): WorldListFilters {
  const orderByParam = params.get('order_by') ?? undefined
  const orderBy = ORDER_BY_VALUES.includes(orderByParam as WorldListOrderBy)
    ? (orderByParam as WorldListOrderBy)
    : undefined
  return {
    search: params.get('search') ?? undefined,
    names: multi(params, 'names'),
    categories: multi(params, 'categories'),
    owner: params.get('owner') ?? undefined,
    only_highlighted: params.get('only_highlighted') === 'true',
    only_favorites: params.get('only_favorites') === 'true',
    order_by: orderBy,
    order: params.get('order') === 'asc' ? 'asc' : ('desc' as OrderDirection),
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    offset: params.get('offset') ? Number(params.get('offset')) : undefined,
    user
  }
}

/** Legacy `GET /api/worlds` — filtered, paginated world list. */
export async function getWorldListHandler(
  context: Pick<HandlerContextWithPath<'worlds', '/api/worlds'>, 'components' | 'url' | 'verification'>
): Promise<HTTPResponse<AggregateWorld[]>> {
  const { worlds } = context.components
  const user = context.verification?.auth?.toLowerCase()

  const { data, total } = await worlds.getWorlds(parseFilters(context.url.searchParams, user))

  return { status: 200, body: { ok: true, data, total } }
}

/** Legacy `GET /api/worlds/:world_id` — a single world with aggregates. */
export async function getWorldHandler(
  context: Pick<HandlerContextWithPath<'worlds', '/api/worlds/:world_id'>, 'components' | 'params' | 'verification'>
): Promise<HTTPResponse<AggregateWorld>> {
  const { worlds } = context.components
  const user = context.verification?.auth?.toLowerCase()

  const data = await worlds.getWorld(context.params.world_id, user)

  return { status: 200, body: { ok: true, data } }
}

/** Legacy `GET /api/world_names` — names of worlds shown in places. */
export async function getWorldNamesHandler(
  context: Pick<HandlerContextWithPath<'worlds', '/api/world_names'>, 'components'>
): Promise<HTTPResponse<string[]>> {
  const { worlds } = context.components

  const data = await worlds.getWorldNames()

  return { status: 200, body: { ok: true, data } }
}
