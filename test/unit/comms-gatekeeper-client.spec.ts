import { createCommsGatekeeperClient } from '../../src/adapters/comms-gatekeeper-client'

describe('when fetching connected participants', () => {
  let logs: any
  let fetcher: { fetch: jest.Mock }

  beforeEach(() => {
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    fetcher = { fetch: jest.fn() }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the gatekeeper is not configured', () => {
    let config: any

    beforeEach(() => {
      config = { getString: jest.fn().mockResolvedValue(undefined) }
    })

    it('should return an empty list without calling the gatekeeper', async () => {
      const client = await createCommsGatekeeperClient({ config, logs, fetcher })
      const participants = await client.getSceneParticipants('0,0')

      expect(participants).toEqual([])
      expect(fetcher.fetch).not.toHaveBeenCalled()
    })
  })

  describe('and the gatekeeper is configured', () => {
    let config: any

    beforeEach(() => {
      config = { getString: jest.fn().mockResolvedValue('https://comms-gatekeeper.decentraland.org') }
      fetcher.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, data: { addresses: ['0xa', '0xb'] } })
      })
    })

    it('should return the participant addresses for a scene', async () => {
      const client = await createCommsGatekeeperClient({ config, logs, fetcher })
      const participants = await client.getSceneParticipants('10,20')

      expect(participants).toEqual(['0xa', '0xb'])
      expect(fetcher.fetch).toHaveBeenCalledWith(expect.stringContaining('pointer=10%2C20'))
    })

    it('should cache repeated lookups for the same key', async () => {
      const client = await createCommsGatekeeperClient({ config, logs, fetcher })
      await client.getWorldParticipants('my-world.dcl.eth')
      await client.getWorldParticipants('my-world.dcl.eth')

      expect(fetcher.fetch).toHaveBeenCalledTimes(1)
    })

    it('should degrade to an empty list on error', async () => {
      fetcher.fetch.mockRejectedValueOnce(new Error('down'))
      const client = await createCommsGatekeeperClient({ config, logs, fetcher })
      const participants = await client.getSceneParticipants('99,99')

      expect(participants).toEqual([])
    })
  })
})
