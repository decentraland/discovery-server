import type { AppComponents } from '../../types'
import type { Place, World } from '../../types/entities'
import { BadRequestError } from '../../types/errors'
import { isPlaceId } from '../entity-id'
import { PlaceNotFoundError } from '../places'
import { WorldNotFoundError } from '../worlds'

// Allowed content ratings (legacy enum + the 'RP' pending code discovery worlds use). Any other
// value would poison the ingestion RATING_RANK guard and, for the varchar(4) places column,
// overflow into a DB 500. Enforced in the logic so every caller is covered, not just the handler.
const VALID_RATINGS = ['PR', 'RP', 'E', 'T', 'A', 'R']

export interface IModerationComponent {
  setPlaceRating(placeId: string, rating: string, moderator: string, comment?: string): Promise<Place>
  setPlaceHighlight(placeId: string, highlighted: boolean): Promise<Place>
  setPlaceDisabled(placeId: string, disabled: boolean, reason?: string): Promise<Place>
  setPlaceRanking(placeId: string, ranking: number | null): Promise<Place>
  setWorldRating(worldId: string, rating: string, moderator: string, comment?: string): Promise<World>
  setWorldHighlight(worldId: string, highlighted: boolean): Promise<World>
  setWorldRanking(worldId: string, ranking: number | null): Promise<World>
}

/**
 * Place/world moderation. Content-rating changes update the entity and append a
 * `content_ratings` audit row in one transaction, preserving who changed the age
 * rating and why. Highlight/disable/ranking are single-field updates.
 */
export async function createModerationComponent(
  components: Pick<
    AppComponents,
    'pg' | 'placesRepository' | 'worldsRepository' | 'contentRatingsRepository' | 'slackNotifier' | 'config' | 'logs'
  >
): Promise<IModerationComponent> {
  const { pg, placesRepository, worldsRepository, contentRatingsRepository, slackNotifier, config } = components

  // Content-moderation alerts channel (legacy CONTENT_MODERATION_SLACK_WEBHOOK); a
  // no-op when Slack or the channel is unconfigured.
  const moderationChannel = (await config.getString('SLACK_CONTENT_MODERATION_CHANNEL')) ?? undefined
  const alert = (text: string) => {
    void slackNotifier.notify(text, moderationChannel)
  }

  // Place ids are uuids; a non-uuid can't exist (and would crash the uuid cast),
  // so reject it as a not-found instead of letting Postgres 500.
  function assertPlaceId(placeId: string): void {
    if (!isPlaceId(placeId)) throw new PlaceNotFoundError(placeId)
  }

  function assertValidRating(rating: string): void {
    if (!VALID_RATINGS.includes(rating)) {
      throw new BadRequestError(`rating must be one of ${VALID_RATINGS.join(', ')}`)
    }
  }

  async function setPlaceRating(placeId: string, rating: string, moderator: string, comment?: string): Promise<Place> {
    assertPlaceId(placeId)
    assertValidRating(rating)
    return pg.withTransaction(async (tx) => {
      // Lock the row first so a concurrent rating change can't make the audit record a stale
      // "original" rating (the read-then-write must be serialized per place).
      await placesRepository.lockById(tx, placeId)
      const current = await placesRepository.findByIdWithAggregates(tx, placeId)
      if (!current) throw new PlaceNotFoundError(placeId)
      const updated = await placesRepository.updateModeration(tx, placeId, { content_rating: rating })
      if (!updated) throw new PlaceNotFoundError(placeId)
      await contentRatingsRepository.record(tx, {
        entityId: current.id,
        originalRating: current.content_rating,
        updateRating: rating,
        moderator,
        comment
      })
      alert(
        `:label: Place content rating changed: ${current.id} ${current.content_rating ?? '—'} → ${rating} by ${moderator}`
      )
      return updated
    })
  }

  async function setPlaceHighlight(placeId: string, highlighted: boolean): Promise<Place> {
    assertPlaceId(placeId)
    const updated = await placesRepository.updateModeration(pg, placeId, { highlighted })
    if (!updated) throw new PlaceNotFoundError(placeId)
    return updated
  }

  async function setPlaceDisabled(placeId: string, disabled: boolean, reason = 'moderation'): Promise<Place> {
    assertPlaceId(placeId)
    const updated = await placesRepository.updateModeration(pg, placeId, {
      disabled,
      disabled_reason: disabled ? reason : null
    })
    if (!updated) throw new PlaceNotFoundError(placeId)
    alert(`:x: Place ${disabled ? 'disabled' : 're-enabled'}: ${placeId}${disabled ? ` (${reason})` : ''}`)
    return updated
  }

  async function setPlaceRanking(placeId: string, ranking: number | null): Promise<Place> {
    assertPlaceId(placeId)
    const updated = await placesRepository.updateModeration(pg, placeId, { ranking })
    if (!updated) throw new PlaceNotFoundError(placeId)
    return updated
  }

  async function setWorldRating(worldId: string, rating: string, moderator: string, comment?: string): Promise<World> {
    assertValidRating(rating)
    return pg.withTransaction(async (tx) => {
      await worldsRepository.lockById(tx, worldId)
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
      alert(
        `:label: World content rating changed: ${current.id} ${current.content_rating ?? '—'} → ${rating} by ${moderator}`
      )
      return updated
    })
  }

  async function setWorldHighlight(worldId: string, highlighted: boolean): Promise<World> {
    const updated = await worldsRepository.updateModeration(pg, worldId, { highlighted })
    if (!updated) throw new WorldNotFoundError(worldId)
    return updated
  }

  async function setWorldRanking(worldId: string, ranking: number | null): Promise<World> {
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
