import { createWorldsComponent, WorldNotFoundError } from '../../src/logic/worlds'
import type { IWorldsRepository } from '../../src/adapters/worlds-repository'

describe('when reading worlds', () => {
  let worldsRepository: jest.Mocked<IWorldsRepository>
  let pg: any
  let worldsLiveData: any
  let logs: any

  beforeEach(() => {
    worldsRepository = {
      findByIdWithAggregates: jest.fn(),
      findWithAggregates: jest.fn(),
      count: jest.fn(),
      findNames: jest.fn(),
      upsert: jest.fn(),
      updateModeration: jest.fn()
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
})
