import { createWorldsComponent, WorldNotFoundError } from '../../src/logic/worlds'
import type { IWorldsRepository } from '../../src/adapters/worlds-repository'

describe('when reading worlds', () => {
  let worldsRepository: jest.Mocked<IWorldsRepository>
  let pg: any
  let worldsLiveData: any
  let logs: any

  beforeEach(() => {
    worldsRepository = {
      lockById: jest.fn(),
      findByIdWithAggregates: jest.fn(),
      findWithAggregates: jest.fn(),
      count: jest.fn(),
      findNames: jest.fn(),
      upsert: jest.fn()
    }
    pg = {}
    worldsLiveData = { getUserCount: jest.fn().mockResolvedValue(0), refresh: jest.fn() }
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and requesting a world that does not exist', () => {
    beforeEach(() => {
      worldsRepository.findByIdWithAggregates.mockResolvedValueOnce(null)
    })

    it('should throw a WorldNotFoundError', async () => {
      const worlds = await createWorldsComponent({ pg, worldsRepository, worldsLiveData, logs })

      await expect(worlds.getWorld('missing.dcl.eth')).rejects.toThrow(WorldNotFoundError)
    })
  })

  describe('and listing worlds', () => {
    beforeEach(() => {
      worldsRepository.findWithAggregates.mockResolvedValueOnce([])
      worldsRepository.count.mockResolvedValueOnce(0)
    })

    it('should return the matching worlds and the total count', async () => {
      const worlds = await createWorldsComponent({ pg, worldsRepository, worldsLiveData, logs })
      const result = await worlds.getWorlds({})

      expect(result).toEqual({ data: [], total: 0 })
    })
  })

  describe('and a stored world carries unsafe markup and image', () => {
    beforeEach(() => {
      worldsRepository.findByIdWithAggregates.mockResolvedValueOnce({
        id: 'my-world.dcl.eth',
        world_name: 'my-world.dcl.eth',
        description: 'Enter <link="file:///etc/passwd">x</link> now',
        image: 'https://10.0.0.1/thumb.png',
        highlighted_image: 'javascript:alert(1)'
      } as never)
    })

    it('should strip the unsafe description markup on read', async () => {
      const worlds = await createWorldsComponent({ pg, worldsRepository, worldsLiveData, logs })
      const result = await worlds.getWorld('my-world.dcl.eth')

      expect(result.description).toBe('Enter x now')
    })

    it('should reject the internal-host image on read', async () => {
      const worlds = await createWorldsComponent({ pg, worldsRepository, worldsLiveData, logs })
      const result = await worlds.getWorld('my-world.dcl.eth')

      expect(result.image).toBeNull()
    })

    it('should reject the unsafe highlighted_image on read', async () => {
      const worlds = await createWorldsComponent({ pg, worldsRepository, worldsLiveData, logs })
      const result = await worlds.getWorld('my-world.dcl.eth')

      expect(result.highlighted_image).toBeNull()
    })
  })
})
