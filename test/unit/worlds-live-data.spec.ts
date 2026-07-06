import { createWorldsLiveDataComponent } from '../../src/adapters/worlds-live-data'

describe('when reading worlds live data', () => {
  let config: any
  let logs: any
  let fetcher: { fetch: jest.Mock }

  beforeEach(() => {
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    fetcher = { fetch: jest.fn() }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the source is not configured', () => {
    beforeEach(() => {
      config = { getString: jest.fn().mockResolvedValue(undefined), getNumber: jest.fn().mockResolvedValue(undefined) }
    })

    it('should report zero users without fetching', async () => {
      const worldsLiveData = await createWorldsLiveDataComponent({ config, logs, fetcher })

      expect(await worldsLiveData.getUserCount('my-world.dcl.eth')).toBe(0)
      expect(fetcher.fetch).not.toHaveBeenCalled()
    })
  })

  describe('and the source returns per-world occupancy', () => {
    beforeEach(() => {
      config = {
        getString: jest.fn().mockResolvedValue('https://worlds-content-server.decentraland.org/live-data'),
        getNumber: jest.fn().mockResolvedValue(undefined)
      }
      fetcher.fetch.mockResolvedValue({
        json: async () => ({ data: { perWorld: [{ worldName: 'My-World.dcl.eth', users: 7 }] } })
      })
    })

    it('should return the user count for a world, case-insensitively', async () => {
      const worldsLiveData = await createWorldsLiveDataComponent({ config, logs, fetcher })

      expect(await worldsLiveData.getUserCount('my-world.dcl.eth')).toBe(7)
    })
  })
})
