import { createLandClient } from '../../src/adapters/land-client'

describe('when using the Land client', () => {
  let config: any
  let logs: any
  let fetcher: { fetch: jest.Mock }

  beforeEach(() => {
    config = { getString: jest.fn().mockResolvedValue('https://api.decentraland.org') }
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    fetcher = { fetch: jest.fn() }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and building map-image urls', () => {
    it('should build the parcel and estate image urls', async () => {
      const client = await createLandClient({ config, logs, fetcher })

      expect(client.getParcelImage(5, 6)).toBe('https://api.decentraland.org/v1/parcels/5/6/map.png')
      expect(client.getEstateImage('42')).toBe('https://api.decentraland.org/v1/estates/42/map.png')
    })
  })

  describe('and fetching a tile that exists', () => {
    beforeEach(() => {
      fetcher.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ '5,6': { estateId: '42', name: 'Big Estate' } })
      })
    })

    it('should return the tile for the requested parcel', async () => {
      const client = await createLandClient({ config, logs, fetcher })
      const tile = await client.getTile(5, 6)

      expect(tile).toEqual({ estateId: '42', name: 'Big Estate' })
      expect(fetcher.fetch).toHaveBeenCalledWith('https://api.decentraland.org/v2/tiles?x1=5&y1=6&x2=5&y2=6')
    })
  })

  describe('and the Land API is unreachable', () => {
    beforeEach(() => {
      fetcher.fetch.mockRejectedValue(new Error('down'))
    })

    it('should degrade to a null tile', async () => {
      const client = await createLandClient({ config, logs, fetcher })

      expect(await client.getTile(5, 6)).toBeNull()
    })
  })
})
