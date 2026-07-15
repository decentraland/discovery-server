import type { Event } from '../../types/entities'

export interface INotificationsComponent {
  /** Notify attendees of events entering the "starts within 1h" window. Returns count published. */
  notifyUpcoming(): Promise<number>
  /** Notify attendees of events that just started. */
  notifyStarted(): Promise<number>
  /** Emit an ended notification per event that just finished. */
  notifyEnded(): Promise<number>
  /** Notify the creator that their event was approved by a moderator. Never throws. */
  notifyEventApproved(event: Event): Promise<void>
  /** Notify the creator that their event was rejected by a moderator. Never throws. */
  notifyEventRejected(event: Event, reason: string): Promise<void>
  /** Notify the creator that their event was deleted by a moderator/admin. Never throws. */
  notifyEventDeleted(event: Event, reason?: string): Promise<void>
  /**
   * Fan a "Community Event Added" notification out to every member of the event's
   * community. Called when a community-attached event becomes public (approved).
   * A no-op (and never throws) when the event has no community or communities is
   * unconfigured.
   */
  notifyCommunityEventPublished(event: Event): Promise<void>
}
