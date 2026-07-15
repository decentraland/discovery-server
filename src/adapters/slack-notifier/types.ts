export interface ISlackNotifier {
  /** Fire-and-forget Slack message; a no-op when Slack is not configured. */
  notify(text: string, channel?: string): Promise<void>
}
