import { createCatalystClient } from '../../src/adapters/catalyst-client'

describe('when resolving operated lands from Catalyst', () => {
  let logs: any
  let fetcher: { fetch: jest.Mock }

  const page = (elements: Array<{ x: string; y: string }>) => ({ ok: true, json: async () => ({ elements }) })

  beforeEach(() => {
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    fetcher = { fetch: jest.fn() }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the wallet operates a single short page of parcels', () => {
    let config: any

    beforeEach(() => {
      config = { getString: jest.fn().mockResolvedValue('https://peer.decentraland.org') }
      fetcher.fetch.mockResolvedValueOnce(
        page([
          { x: '10', y: '20' },
          { x: '-5', y: '3' }
        ])
      )
    })

    it('should return the parcels as "x,y" positions', async () => {
      const client = await createCatalystClient({ config, logs, fetcher })
      const positions = await client.getOperatedPositions('0xABC')

      expect(positions).toEqual(['10,20', '-5,3'])
    })

    it('should lowercase the address in the request path', async () => {
      const client = await createCatalystClient({ config, logs, fetcher })
      await client.getOperatedPositions('0xABC')

      expect(fetcher.fetch).toHaveBeenCalledWith(expect.stringContaining('/lambdas/users/0xabc/lands-permissions'))
    })
  })

  describe('and the wallet operates more than one page', () => {
    let config: any

    beforeEach(() => {
      config = { getString: jest.fn().mockResolvedValue('https://peer.decentraland.org') }
      const full = Array.from({ length: 100 }, (_, i) => ({ x: String(i), y: '0' }))
      fetcher.fetch.mockResolvedValueOnce(page(full)).mockResolvedValueOnce(page([{ x: '999', y: '0' }]))
    })

    it('should walk pages until a short page ends the list', async () => {
      const client = await createCatalystClient({ config, logs, fetcher })
      const positions = await client.getOperatedPositions('0xabc')

      expect(fetcher.fetch).toHaveBeenCalledTimes(2)
      expect(positions).toHaveLength(101)
    })
  })

  describe('and the request fails', () => {
    let config: any

    beforeEach(() => {
      config = { getString: jest.fn().mockResolvedValue('https://peer.decentraland.org') }
      fetcher.fetch.mockRejectedValueOnce(new Error('down'))
    })

    it('should degrade to an empty list', async () => {
      const client = await createCatalystClient({ config, logs, fetcher })
      const positions = await client.getOperatedPositions('0xabc')

      expect(positions).toEqual([])
    })
  })
})
