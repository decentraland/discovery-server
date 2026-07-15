import SQL from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { ContentRatingAudit, IContentRatingsRepository } from './types'

/** Owns SQL for the `content_ratings` moderation audit table (append-only). */
export function createContentRatingsRepository(): IContentRatingsRepository {
  async function record(client: Queryable, audit: ContentRatingAudit): Promise<void> {
    await client.query(SQL`
      INSERT INTO content_ratings (entity_id, original_rating, update_rating, moderator, comment)
      VALUES (${audit.entityId}, ${audit.originalRating}, ${audit.updateRating}, ${audit.moderator.toLowerCase()}, ${audit.comment ?? null})`)
  }

  return { record }
}
