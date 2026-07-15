import { createSnapshotClient } from '../../src/adapters/snapshot-client'

describe('when fetching voting power', () => {
  let config: any
  let logs: any
  let fetcher: { fetch: jest.Mock }

  beforeEach(() => {
    config = { getString: jest.fn().mockResolvedValue(undefined) }
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    fetcher = { fetch: jest.fn() }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the address is not a valid wallet', () => {
    it('should return zero without calling Snapshot', async () => {
      const client = await createSnapshotClient({ config, logs, fetcher })
      const vp = await client.getVotingPower('not-an-address')

      expect(vp).toBe(0)
      expect(fetcher.fetch).not.toHaveBeenCalled()
    })
  })

  describe('and Snapshot returns a voting power', () => {
    beforeEach(() => {
      fetcher.fetch.mockResolvedValue({ ok: true, json: async () => ({ result: { vp: 1234.7 } }) })
    })

    it('should return the truncated integer voting power', async () => {
      const client = await createSnapshotClient({ config, logs, fetcher })
      const vp = await client.getVotingPower('0x1234567890123456789012345678901234567890')

      expect(vp).toBe(1234)
    })

    it('should cache the result and not re-fetch for the same address', async () => {
      const client = await createSnapshotClient({ config, logs, fetcher })
      const address = '0x1234567890123456789012345678901234567890'
      await client.getVotingPower(address)
      await client.getVotingPower(address)

      expect(fetcher.fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the Snapshot request fails', () => {
    beforeEach(() => {
      fetcher.fetch.mockRejectedValue(new Error('network down'))
    })

    it('should degrade to zero', async () => {
      const client = await createSnapshotClient({ config, logs, fetcher })
      const vp = await client.getVotingPower('0xabcdef0123456789abcdef0123456789abcdef01')

      expect(vp).toBe(0)
    })
  })

  describe('and Snapshot responds with a non-ok status', () => {
    beforeEach(() => {
      fetcher.fetch
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { vp: 42 } }) })
    })

    it('should not cache the failure and recover on the next call', async () => {
      const client = await createSnapshotClient({ config, logs, fetcher })
      const address = '0xabcdef0123456789abcdef0123456789abcdef01'

      expect(await client.getVotingPower(address)).toBe(0)
      expect(await client.getVotingPower(address)).toBe(42)
    })
  })
})
