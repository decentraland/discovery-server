import type { AggregatePlace } from '../../types/entities'

export interface IModerationComponent {
  setPlaceRating(placeId: string, rating: string, moderator: string, comment?: string): Promise<AggregatePlace>
  setPlaceHighlight(placeId: string, highlighted: boolean): Promise<AggregatePlace>
  setPlaceRanking(placeId: string, ranking: number | null): Promise<AggregatePlace>
  setPlaceDisabled(placeId: string, disabled: boolean, reason?: string): Promise<AggregatePlace>
}
