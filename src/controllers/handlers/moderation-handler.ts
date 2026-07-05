import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Place, World } from '../../types/entities'
import { BadRequestError, UnauthorizedError } from '../../types/errors'

async function readBody<T extends Record<string, unknown>>(context: {
  request: { json: () => Promise<unknown> }
}): Promise<T> {
  try {
    return (await context.request.json()) as T
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }
}

/** Legacy `PUT /api/places/:place_id/rating` (signed admin). */
export async function updatePlaceRatingHandler(
  context: Pick<
    HandlerContextWithPath<'moderation', '/api/places/:place_id/rating'>,
    'components' | 'params' | 'request' | 'verification'
  >
): Promise<HTTPResponse<Place>> {
  const moderator = context.verification?.auth?.toLowerCase()
  if (!moderator) throw new UnauthorizedError('Authentication required')
  const body = await readBody<{ rating?: string; comment?: string }>(context)
  if (!body.rating) throw new BadRequestError('rating is required')

  const data = await context.components.moderation.setPlaceRating(
    context.params.place_id,
    body.rating,
    moderator,
    body.comment
  )
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `PUT /api/places/:place_id/highlight` (signed admin). */
export async function updatePlaceHighlightHandler(
  context: Pick<
    HandlerContextWithPath<'moderation', '/api/places/:place_id/highlight'>,
    'components' | 'params' | 'request'
  >
): Promise<HTTPResponse<Place>> {
  const body = await readBody<{ highlighted?: boolean }>(context)
  const data = await context.components.moderation.setPlaceHighlight(
    context.params.place_id,
    body.highlighted !== false
  )
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `PUT /api/places/:place_id/disable` (signed admin). */
export async function updatePlaceDisabledHandler(
  context: Pick<
    HandlerContextWithPath<'moderation', '/api/places/:place_id/disable'>,
    'components' | 'params' | 'request'
  >
): Promise<HTTPResponse<Place>> {
  const body = await readBody<{ disabled?: boolean }>(context)
  const data = await context.components.moderation.setPlaceDisabled(context.params.place_id, body.disabled !== false)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `PUT /api/places/:place_id/ranking` (data-team bearer). */
export async function updatePlaceRankingHandler(
  context: Pick<
    HandlerContextWithPath<'moderation', '/api/places/:place_id/ranking'>,
    'components' | 'params' | 'request'
  >
): Promise<HTTPResponse<Place>> {
  const body = await readBody<{ ranking?: number }>(context)
  if (typeof body.ranking !== 'number') throw new BadRequestError('ranking must be a number')
  const data = await context.components.moderation.setPlaceRanking(context.params.place_id, body.ranking)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `PUT /api/worlds/:world_id/rating` (signed admin). */
export async function updateWorldRatingHandler(
  context: Pick<
    HandlerContextWithPath<'moderation', '/api/worlds/:world_id/rating'>,
    'components' | 'params' | 'request' | 'verification'
  >
): Promise<HTTPResponse<World>> {
  const moderator = context.verification?.auth?.toLowerCase()
  if (!moderator) throw new UnauthorizedError('Authentication required')
  const body = await readBody<{ rating?: string; comment?: string }>(context)
  if (!body.rating) throw new BadRequestError('rating is required')

  const data = await context.components.moderation.setWorldRating(
    context.params.world_id,
    body.rating,
    moderator,
    body.comment
  )
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `PUT /api/worlds/:world_id/highlight` (signed admin). */
export async function updateWorldHighlightHandler(
  context: Pick<
    HandlerContextWithPath<'moderation', '/api/worlds/:world_id/highlight'>,
    'components' | 'params' | 'request'
  >
): Promise<HTTPResponse<World>> {
  const body = await readBody<{ highlighted?: boolean }>(context)
  const data = await context.components.moderation.setWorldHighlight(
    context.params.world_id,
    body.highlighted !== false
  )
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `PUT /api/worlds/:world_id/ranking` (data-team bearer). */
export async function updateWorldRankingHandler(
  context: Pick<
    HandlerContextWithPath<'moderation', '/api/worlds/:world_id/ranking'>,
    'components' | 'params' | 'request'
  >
): Promise<HTTPResponse<World>> {
  const body = await readBody<{ ranking?: number }>(context)
  if (typeof body.ranking !== 'number') throw new BadRequestError('ranking must be a number')
  const data = await context.components.moderation.setWorldRanking(context.params.world_id, body.ranking)
  return { status: 200, body: { ok: true, data } }
}
