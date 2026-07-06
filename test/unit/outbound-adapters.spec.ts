import { createSnsPublisher } from '../../src/adapters/sns-publisher'
import { createSlackNotifier } from '../../src/adapters/slack-notifier'

describe('when the outbound adapters are not configured', () => {
  let config: any
  let logs: any

  beforeEach(() => {
    config = { getString: jest.fn().mockResolvedValue(undefined) }
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and creating the SNS publisher without an ARN', () => {
    it('should report itself disabled', async () => {
      const publisher = await createSnsPublisher({ config, logs })

      expect(publisher.enabled).toBe(false)
    })

    it('should publish nothing without error', async () => {
      const publisher = await createSnsPublisher({ config, logs })
      const result = await publisher.publish([{ type: 'test' } as any])

      expect(result).toEqual({ published: 0, failed: 0 })
    })
  })

  describe('and creating the Slack notifier without a token', () => {
    it('should be a no-op that resolves without error', async () => {
      const notifier = await createSlackNotifier({ config, logs })

      await expect(notifier.notify('hello', 'channel')).resolves.toBeUndefined()
    })
  })
})
