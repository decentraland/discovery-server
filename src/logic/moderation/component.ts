import type { AppComponents } from '../../types'
import type { AggregatePlace } from '../../types/entities'
import type { Queryable } from '../../adapters/pg'
import { BadRequestError } from '../../types/errors'
import { isPlaceId } from '../entity-id'
import { sanitizeEntityContent } from '../content-sanitization'
import { PlaceNotFoundError } from '../places'
import type { IModerationComponent } from './types'

// Allowed content ratings (legacy enum + the 'RP' pending code discovery worlds use). Any other
// value would poison the ingestion RATING_RANK guard and, for the varchar(4) places column,
// overflow into a DB 500. Enforced in the logic so every caller is covered, not just the handler.
const VALID_RATINGS = ['PR', 'RP', 'E', 'T', 'A', 'R']

/**
 * Place/world moderation. Content-rating changes update the entity and append a
 * `content_ratings` audit row in one transaction, preserving who changed the age
 * rating and why. Highlight/disable/ranking are single-field updates.
 */
export async function createModerationComponent(
  components: Pick<
    AppComponents,
    'pg' | 'placesRepository' | 'contentRatingsRepository' | 'slackNotifier' | 'config' | 'logs'
  >
): Promise<IModerationComponent> {
  const { pg, placesRepository, contentRatingsRepository, slackNotifier, config } = components

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

  // Re-read the full aggregate (with the actor's like/favorite flags) so a moderation response
  // carries the same shape as a normal place/world read — legacy returned the aggregate too.
  async function placeAggregate(client: Queryable, placeId: string, user?: string): Promise<AggregatePlace> {
    const aggregate = await placesRepository.findByIdWithAggregates(client, placeId, user)
    if (!aggregate) throw new PlaceNotFoundError(placeId)
    // Sanitize at this read boundary too: moderation responses carry the same aggregate shape as
    // a normal place read, so a legacy/imported unsafe description/image must not slip through here.
    return sanitizeEntityContent(aggregate)
  }
  async function setPlaceRating(
    placeId: string,
    rating: string,
    moderator: string,
    comment?: string
  ): Promise<AggregatePlace> {
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
      return placeAggregate(tx, placeId, moderator)
    })
  }

  async function setPlaceHighlight(placeId: string, highlighted: boolean): Promise<AggregatePlace> {
    assertPlaceId(placeId)
    const updated = await placesRepository.updateModeration(pg, placeId, { highlighted })
    if (!updated) throw new PlaceNotFoundError(placeId)
    return placeAggregate(pg, placeId)
  }

  async function setPlaceRanking(placeId: string, ranking: number | null): Promise<AggregatePlace> {
    assertPlaceId(placeId)
    const updated = await placesRepository.updateModeration(pg, placeId, { ranking })
    if (!updated) throw new PlaceNotFoundError(placeId)
    return placeAggregate(pg, placeId)
  }

  // Admin disable/re-enable of a place. A moderation disable always records reason 'moderation'
  // and updateModeration stamps disabled_at; re-enabling clears both the flag and the reason.
  async function setPlaceDisabled(placeId: string, disabled: boolean, reason = 'moderation'): Promise<AggregatePlace> {
    assertPlaceId(placeId)
    const updated = await placesRepository.updateModeration(pg, placeId, {
      disabled,
      disabled_reason: disabled ? reason : null
    })
    if (!updated) throw new PlaceNotFoundError(placeId)
    alert(`:x: Place ${disabled ? 'disabled' : 're-enabled'}: ${placeId}${disabled ? ` (${reason})` : ''}`)
    return placeAggregate(pg, placeId)
  }

  return {
    setPlaceRating,
    setPlaceHighlight,
    setPlaceRanking,
    setPlaceDisabled
  }
}
