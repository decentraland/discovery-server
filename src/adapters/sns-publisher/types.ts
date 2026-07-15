import type { IPublisherComponent } from '@dcl/sns-component'

export type PublishableEvents = Parameters<IPublisherComponent['publishMessages']>[0]

export interface ISnsPublisher {
  /** Whether SNS publishing is configured (AWS_SNS_ARN present). */
  readonly enabled: boolean
  /**
   * Publish a batch of events; a no-op returning `{ published: 0, failed: 0 }`
   * when SNS is not configured. `failed` is the count of events SNS rejected so
   * callers can decide whether to advance an idempotency cursor.
   */
  publish(events: PublishableEvents): Promise<{ published: number; failed: number }>
}
