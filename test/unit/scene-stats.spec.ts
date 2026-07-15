import { createSceneStatsComponent } from '../../src/adapters/scene-stats'

describe('when reading scene stats', () => {
  let logs: any
  let fetcher: { fetch: jest.Mock }

  beforeEach(() => {
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    fetcher = { fetch: jest.fn() }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the data-team CDN is not configured', () => {
    let config: any

    beforeEach(() => {
      config = { getString: jest.fn().mockResolvedValue(undefined), getNumber: jest.fn().mockResolvedValue(undefined) }
    })

    it('should return zero visits without fetching', async () => {
      const sceneStats = await createSceneStatsComponent({ config, logs, fetcher })

      expect(await sceneStats.getVisits('10,20')).toBe(0)
      expect(fetcher.fetch).not.toHaveBeenCalled()
    })
  })

  describe('and the CDN returns scene stats', () => {
    let config: any

    beforeEach(() => {
      config = {
        getString: jest.fn().mockResolvedValue('https://cdn-data.decentraland.org'),
        getNumber: jest.fn().mockResolvedValue(undefined)
      }
      fetcher.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ '10,20': { last_30d: { users: 4200 } } })
      })
    })

    it('should return the 30-day visit count for a base position', async () => {
      const sceneStats = await createSceneStatsComponent({ config, logs, fetcher })

      expect(await sceneStats.getVisits('10,20')).toBe(4200)
    })

    it('should return zero for a position with no stats', async () => {
      const sceneStats = await createSceneStatsComponent({ config, logs, fetcher })

      expect(await sceneStats.getVisits('99,99')).toBe(0)
    })

    it('should cache the snapshot for repeated reads', async () => {
      const sceneStats = await createSceneStatsComponent({ config, logs, fetcher })
      await sceneStats.getVisits('10,20')
      await sceneStats.getVisits('10,20')

      expect(fetcher.fetch).toHaveBeenCalledTimes(1)
    })
  })
})
