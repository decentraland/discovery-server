import type { Queryable } from '../pg'

export type ContentRatingAudit = {
  entityId: string
  originalRating: string | null
  updateRating: string
  moderator: string
  comment?: string | null
}

export interface IContentRatingsRepository {
  /** Append a moderation audit row recording who changed an entity's rating and why. */
  record(client: Queryable, audit: ContentRatingAudit): Promise<void>
}
