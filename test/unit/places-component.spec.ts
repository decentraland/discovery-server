import { createPlacesComponent, PlaceNotFoundError } from '../../src/logic/places'
import type { IPlacesRepository } from '../../src/adapters/places-repository'
import type { AggregatePlace } from '../../src/types/entities'

describe('when reading places', () => {
  let placesRepository: jest.Mocked<IPlacesRepository>
  let pg: any
  let hotScenes: any
  let logs: any

  beforeEach(() => {
    placesRepository = {
      findByIdWithAggregates: jest.fn(),
      findByIds: jest.fn(),
      findWithAggregates: jest.fn(),
      count: jest.fn(),
      insert: jest.fn(),
      updateModeration: jest.fn(),
      upsertScene: jest.fn()
    }
    pg = {}
    hotScenes = {
      getUserCount: jest.fn().mockResolvedValue(0),
      getActivePositions: jest.fn().mockResolvedValue([]),
      refresh: jest.fn()
    }
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and requesting a place that does not exist', () => {
    beforeEach(() => {
      placesRepository.findByIdWithAggregates.mockResolvedValueOnce(null)
    })

    it('should throw a PlaceNotFoundError', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, logs })

      await expect(places.getPlace('missing')).rejects.toThrow(PlaceNotFoundError)
    })
  })

  describe('and listing places', () => {
    let place: AggregatePlace

    beforeEach(() => {
      place = { id: 'p1', base_position: '0,0' } as AggregatePlace
      placesRepository.findWithAggregates.mockResolvedValueOnce([place])
      placesRepository.count.mockResolvedValueOnce(1)
    })

    it('should return the matching places, a total count, and a decorated user_count', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, logs })
      const result = await places.getPlaces({ only_highlighted: true })

      expect(result).toEqual({ data: [{ ...place, user_count: 0 }], total: 1 })
    })

    it('should resolve most_active positions from hot scenes when ordering by most_active', async () => {
      hotScenes.getActivePositions.mockResolvedValueOnce(['0,0', '1,1'])
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, logs })
      await places.getPlaces({ order_by: 'most_active' })

      expect(placesRepository.findWithAggregates).toHaveBeenCalledWith(
        pg,
        expect.objectContaining({ order_by: 'most_active', mostActivePositions: ['0,0', '1,1'] })
      )
    })
  })

  describe('and requesting places by ids', () => {
    beforeEach(() => {
      placesRepository.findWithAggregates.mockResolvedValueOnce([])
    })

    it('should query the repository with the valid uuid ids filter', async () => {
      const ids = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, logs })
      await places.getPlacesByIds([...ids, 'not-a-uuid'], '0xUSER')

      expect(placesRepository.findWithAggregates).toHaveBeenCalledWith(
        pg,
        expect.objectContaining({ ids, user: '0xUSER' })
      )
    })
  })

  describe('and requesting places by an empty id list', () => {
    it('should short-circuit without querying the repository', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, logs })
      const result = await places.getPlacesByIds([])

      expect(result).toEqual([])
      expect(placesRepository.findWithAggregates).not.toHaveBeenCalled()
    })
  })
})
