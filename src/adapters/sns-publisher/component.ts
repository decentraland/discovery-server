import { createSnsComponent } from '@dcl/sns-component'
import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { ISnsPublisher, PublishableEvents } from './types'

/**
 * Optional SNS publisher. @dcl/sns-component requires AWS_SNS_ARN at creation, so
 * it is only instantiated when configured; otherwise this is a no-op and the app
 * boots fine in dev/test without an SNS topic.
 */
export async function createSnsPublisher(
  components: Pick<{ config: IConfigComponent; logs: ILoggerComponent }, 'config' | 'logs'>
): Promise<ISnsPublisher> {
  const { config, logs } = components
  const logger = logs.getLogger('sns-publisher')

  const arn = await config.getString('AWS_SNS_ARN')
  const publisher = arn ? await createSnsComponent({ config }) : undefined

  async function publish(events: PublishableEvents): Promise<{ published: number; failed: number }> {
    if (!publisher || !events.length) return { published: 0, failed: 0 }
    const result = await publisher.publishMessages(events)
    if (result.failedEvents.length) {
      logger.warn(`Failed to publish ${result.failedEvents.length} of ${events.length} SNS events`)
    }
    return { published: result.successfulMessageIds.length, failed: result.failedEvents.length }
  }

  return { enabled: !!publisher, publish }
}
