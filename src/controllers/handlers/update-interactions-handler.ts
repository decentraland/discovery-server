import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import { BadRequestError, UnauthorizedError } from '../../types/errors'
import { resolveEntityType } from '../../logic/entity-id'

export type InteractionSummary = {
  likes: number
  dislikes: number
  favorites: number
  user_like: boolean
  user_dislike: boolean
  user_favorite: boolean
}

export async function refreshedSummary(
  components: Pick<HandlerContextWithPath<'places' | 'worlds'>['components'], 'places' | 'worlds'>,
  entityId: string,
  entityType: 'place' | 'world',
  user: string
): Promise<InteractionSummary> {
  const entity =
    entityType === 'place'
      ? await components.places.getPlace(entityId, user)
      : await components.worlds.getWorld(entityId, user)
  return {
    likes: entity.likes,
    dislikes: entity.dislikes,
    favorites: entity.favorites,
    user_like: entity.user_like,
    user_dislike: entity.user_dislike,
    user_favorite: entity.user_favorite
  }
}

/** Legacy `PATCH /api/places/:entity_id/likes` and `/api/worlds/:world_id/likes`. */
export async function updateLikesHandler(
  context: Pick<
    HandlerContextWithPath<'interactions' | 'places' | 'worlds'>,
    'components' | 'params' | 'request' | 'verification'
  >
): Promise<HTTPResponse<InteractionSummary>> {
  const { interactions } = context.components
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  const entityId =
    (context.params as Record<string, string>).entity_id ?? (context.params as Record<string, string>).world_id
  const entityType = resolveEntityType(entityId)

  let body: { like?: unknown }
  try {
    body = (await context.request.json()) as { like?: unknown }
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }
  if (!(body.like === null || typeof body.like === 'boolean')) {
    throw new BadRequestError('Body must contain a boolean or null "like"')
  }

  await interactions.setLike({ entityId, entityType, user, like: body.like })

  return {
    status: 200,
    body: { ok: true, data: await refreshedSummary(context.components, entityId, entityType, user) }
  }
}

/** Legacy `PATCH /api/places/:entity_id/favorites` and `/api/worlds/:world_id/favorites`. */
export async function updateFavoritesHandler(
  context: Pick<
    HandlerContextWithPath<'interactions' | 'places' | 'worlds'>,
    'components' | 'params' | 'request' | 'verification'
  >
): Promise<HTTPResponse<InteractionSummary>> {
  const { interactions } = context.components
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  const entityId =
    (context.params as Record<string, string>).entity_id ?? (context.params as Record<string, string>).world_id
  const entityType = resolveEntityType(entityId)

  let body: { favorites?: unknown }
  try {
    body = (await context.request.json()) as { favorites?: unknown }
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }
  if (typeof body.favorites !== 'boolean') {
    throw new BadRequestError('Body must contain a boolean "favorites"')
  }

  await interactions.setFavorite({ entityId, entityType, user, favorite: body.favorites })

  return {
    status: 200,
    body: { ok: true, data: await refreshedSummary(context.components, entityId, entityType, user) }
  }
}
