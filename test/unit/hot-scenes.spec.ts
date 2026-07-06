import { createHotScenesComponent } from '../../src/adapters/hot-scenes'

describe('when reading hot scenes', () => {
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

  describe('and the realm provider is not configured', () => {
    beforeEach(() => {
      config = { getString: jest.fn().mockResolvedValue(undefined), getNumber: jest.fn().mockResolvedValue(undefined) }
    })

    it('should report zero users and no active positions without fetching', async () => {
      const hotScenes = await createHotScenesComponent({ config, logs, fetcher })

      expect(await hotScenes.getUserCount('0,0')).toBe(0)
      expect(await hotScenes.getActivePositions()).toEqual([])
      expect(fetcher.fetch).not.toHaveBeenCalled()
    })
  })

  describe('and the realm provider returns hot scenes', () => {
    beforeEach(() => {
      config = {
        getString: jest.fn().mockResolvedValue('https://realm-provider.decentraland.org'),
        getNumber: jest.fn().mockResolvedValue(undefined)
      }
      fetcher.fetch.mockResolvedValue({
        ok: true,
        json: async () => [
          { id: 's1', name: 'Busy', baseCoords: [10, 20], usersTotalCount: 5, parcels: [[10, 20]] },
          { id: 's2', name: 'Empty', baseCoords: [0, 0], usersTotalCount: 0, parcels: [[0, 0]] }
        ]
      })
    })

    it('should return the user count for a scene base position', async () => {
      const hotScenes = await createHotScenesComponent({ config, logs, fetcher })

      expect(await hotScenes.getUserCount('10,20')).toBe(5)
    })

    it('should return only base positions with users as active', async () => {
      const hotScenes = await createHotScenesComponent({ config, logs, fetcher })

      expect(await hotScenes.getActivePositions()).toEqual(['10,20'])
    })
  })
})
