import { createCommunitiesClient } from '../../src/adapters/communities-client'

describe('when using the communities client', () => {
  let logs: any
  let fetcher: { fetch: jest.Mock }

  beforeEach(() => {
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    fetcher = { fetch: jest.fn() }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the communities API is not configured', () => {
    let config: any

    beforeEach(() => {
      config = { getString: jest.fn().mockResolvedValue(undefined) }
    })

    it('should report itself disabled', async () => {
      const client = await createCommunitiesClient({ config, logs, fetcher })

      expect(client.enabled).toBe(false)
    })

    it('should return an empty managed list without calling the API', async () => {
      const client = await createCommunitiesClient({ config, logs, fetcher })
      const managed = await client.getManagedCommunities('0xABC')

      expect(managed).toEqual([])
      expect(fetcher.fetch).not.toHaveBeenCalled()
    })

    it('should return an empty member list without calling the API', async () => {
      const client = await createCommunitiesClient({ config, logs, fetcher })
      const members = await client.getCommunityMembers('community-1')

      expect(members).toEqual([])
      expect(fetcher.fetch).not.toHaveBeenCalled()
    })
  })

  describe('and the communities API is configured', () => {
    let config: any

    beforeEach(() => {
      config = {
        getString: jest.fn().mockImplementation(async (key: string) => {
          if (key === 'COMMUNITIES_API_URL') return 'https://social.decentraland.org'
          if (key === 'COMMUNITIES_API_ADMIN_TOKEN') return 'token-example'
          return undefined
        })
      }
    })

    it('should report itself enabled', async () => {
      const client = await createCommunitiesClient({ config, logs, fetcher })

      expect(client.enabled).toBe(true)
    })

    describe('and fetching managed communities', () => {
      beforeEach(() => {
        fetcher.fetch.mockResolvedValue({
          json: async () => ({ data: { results: [{ id: 'c1', name: 'One', ownerAddress: '0xowner' }] } })
        })
      })

      it('should lowercase the address and send the bearer token', async () => {
        const client = await createCommunitiesClient({ config, logs, fetcher })
        await client.getManagedCommunities('0xABC')

        expect(fetcher.fetch).toHaveBeenCalledWith(
          'https://social.decentraland.org/v1/communities/0xabc/managed',
          expect.objectContaining({ headers: { authorization: 'Bearer token-example' } })
        )
      })

      it('should return the communities from the response', async () => {
        const client = await createCommunitiesClient({ config, logs, fetcher })
        const managed = await client.getManagedCommunities('0xABC')

        expect(managed).toEqual([{ id: 'c1', name: 'One', ownerAddress: '0xowner' }])
      })

      it('should degrade to an empty list on error', async () => {
        fetcher.fetch.mockRejectedValueOnce(new Error('down'))
        const client = await createCommunitiesClient({ config, logs, fetcher })
        const managed = await client.getManagedCommunities('0xABC')

        expect(managed).toEqual([])
      })
    })

    describe('and fetching community members across multiple pages', () => {
      beforeEach(() => {
        fetcher.fetch
          .mockResolvedValueOnce({
            json: async () => ({ data: { results: [{ memberAddress: '0xAAA' }], page: 1, pages: 2 } })
          })
          .mockResolvedValueOnce({
            json: async () => ({ data: { results: [{ memberAddress: '0xBBB' }], page: 2, pages: 2 } })
          })
      })

      it('should follow pagination and return every member lowercased', async () => {
        const client = await createCommunitiesClient({ config, logs, fetcher })
        const members = await client.getCommunityMembers('community-1')

        expect(members).toEqual(['0xaaa', '0xbbb'])
      })

      it('should request each page with limit and offset', async () => {
        const client = await createCommunitiesClient({ config, logs, fetcher })
        await client.getCommunityMembers('community-1')

        expect(fetcher.fetch).toHaveBeenNthCalledWith(
          1,
          'https://social.decentraland.org/v1/communities/community-1/members?limit=100&offset=0',
          expect.anything()
        )
        expect(fetcher.fetch).toHaveBeenNthCalledWith(
          2,
          'https://social.decentraland.org/v1/communities/community-1/members?limit=100&offset=100',
          expect.anything()
        )
      })
    })

    describe('and fetching community members fails midway', () => {
      beforeEach(() => {
        fetcher.fetch.mockRejectedValueOnce(new Error('down'))
      })

      it('should return whatever was collected so far', async () => {
        const client = await createCommunitiesClient({ config, logs, fetcher })
        const members = await client.getCommunityMembers('community-1')

        expect(members).toEqual([])
      })
    })
  })
})
