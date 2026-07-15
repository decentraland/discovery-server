import { createSlackComponent } from '@dcl/slack-component'
import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { ISlackNotifier } from './types'

/**
 * Thin wrapper over @dcl/slack-component. Fire-and-forget: failures are logged,
 * never thrown, so moderation/ingestion flows are never blocked by Slack. When
 * `SLACK_BOT_TOKEN` is unset the notifier is a no-op (dev/test).
 */
export async function createSlackNotifier(
  components: Pick<{ config: IConfigComponent; logs: ILoggerComponent }, 'config' | 'logs'>
): Promise<ISlackNotifier> {
  const { config, logs } = components
  const logger = logs.getLogger('slack-notifier')

  const token = await config.getString('SLACK_BOT_TOKEN')
  const defaultChannel = await config.getString('SLACK_DEFAULT_CHANNEL')
  const slack = token ? await createSlackComponent({ logs }, { token }) : undefined

  async function notify(text: string, channel?: string): Promise<void> {
    const target = channel ?? defaultChannel
    if (!slack || !target) return
    try {
      await slack.sendMessage({ channel: target, text })
    } catch (error: any) {
      logger.warn(`Failed to send Slack message: ${error?.message ?? String(error)}`)
    }
  }

  return { notify }
}
