import type { AppComponents } from '../../types'
import type { Place, World } from '../../types/entities'
import { PlaceNotFoundError } from '../places'
import { WorldNotFoundError } from '../worlds'

export interface IModerationComponent {
  setPlaceRating(placeId: string, rating: string, moderator: string, comment?: string): Promise<Place>
  setPlaceHighlight(placeId: string, highlighted: boolean): Promise<Place>
  setPlaceDisabled(placeId: string, disabled: boolean, reason?: string): Promise<Place>
  setPlaceRanking(placeId: string, ranking: number): Promise<Place>
  setWorldRating(worldId: string, rating: string, moderator: string, comment?: string): Promise<World>
  setWorldHighlight(worldId: string, highlighted: boolean): Promise<World>
  setWorldRanking(worldId: string, ranking: number): Promise<World>
}

/**
 * Place/world moderation. Content-rating changes update the entity and append a
 * `content_ratings` audit row in one transaction, preserving who changed the age
 * rating and why. Highlight/disable/ranking are single-field updates.
 */
export async function createModerationComponent(
  components: Pick<AppComponents, 'pg' | 'placesRepository' | 'worldsRepository' | 'contentRatingsRepository' | 'logs'>
): Promise<IModerationComponent> {
  const { pg, placesRepository, worldsRepository, contentRatingsRepository } = components

  async function setPlaceRating(placeId: string, rating: string, moderator: string, comment?: string): Promise<Place> {
    return pg.withTransaction(async (tx) => {
      const current = await placesRepository.findByIdWithAggregates(tx, placeId)
      if (!current) throw new PlaceNotFoundError(placeId)
      const updated = await placesRepository.updateModeration(tx, placeId, { content_rating: rating })
      if (!updated) throw new PlaceNotFoundError(placeId)
      await contentRatingsRepository.record(tx, {
        entityId: placeId,
        originalRating: current.content_rating,
        updateRating: rating,
        moderator,
        comment
      })
      return updated
    })
  }

  async function setPlaceHighlight(placeId: string, highlighted: boolean): Promise<Place> {
    const updated = await placesRepository.updateModeration(pg, placeId, { highlighted })
    if (!updated) throw new PlaceNotFoundError(placeId)
    return updated
  }

  async function setPlaceDisabled(placeId: string, disabled: boolean, reason = 'moderation'): Promise<Place> {
    const updated = await placesRepository.updateModeration(pg, placeId, {
      disabled,
      disabled_reason: disabled ? reason : null
    })
    if (!updated) throw new PlaceNotFoundError(placeId)
    return updated
  }

  async function setPlaceRanking(placeId: string, ranking: number): Promise<Place> {
    const updated = await placesRepository.updateModeration(pg, placeId, { ranking })
    if (!updated) throw new PlaceNotFoundError(placeId)
    return updated
  }

  async function setWorldRating(worldId: string, rating: string, moderator: string, comment?: string): Promise<World> {
    return pg.withTransaction(async (tx) => {
      const current = await worldsRepository.findByIdWithAggregates(tx, worldId)
      if (!current) throw new WorldNotFoundError(worldId)
      const updated = await worldsRepository.updateModeration(tx, worldId, { content_rating: rating })
      if (!updated) throw new WorldNotFoundError(worldId)
      await contentRatingsRepository.record(tx, {
        entityId: current.id,
        originalRating: current.content_rating,
        updateRating: rating,
        moderator,
        comment
      })
      return updated
    })
  }

  async function setWorldHighlight(worldId: string, highlighted: boolean): Promise<World> {
    const updated = await worldsRepository.updateModeration(pg, worldId, { highlighted })
    if (!updated) throw new WorldNotFoundError(worldId)
    return updated
  }

  async function setWorldRanking(worldId: string, ranking: number): Promise<World> {
    const updated = await worldsRepository.updateModeration(pg, worldId, { ranking })
    if (!updated) throw new WorldNotFoundError(worldId)
    return updated
  }

  return {
    setPlaceRating,
    setPlaceHighlight,
    setPlaceDisabled,
    setPlaceRanking,
    setWorldRating,
    setWorldHighlight,
    setWorldRanking
  }
}
