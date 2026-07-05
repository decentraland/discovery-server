import { createPlacesComponent, PlaceNotFoundError } from '../../src/logic/places'
import type { IPlacesRepository } from '../../src/adapters/places-repository'
import type { AggregatePlace } from '../../src/types/entities'

describe('when reading places', () => {
  let placesRepository: jest.Mocked<IPlacesRepository>
  let pg: any
  let logs: any

  beforeEach(() => {
    placesRepository = {
      findByIdWithAggregates: jest.fn(),
      findByIds: jest.fn(),
      findWithAggregates: jest.fn(),
      count: jest.fn(),
      insert: jest.fn()
    }
    pg = {}
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
      const places = await createPlacesComponent({ pg, placesRepository, logs })

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

    it('should return the matching places and the total count', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, logs })
      const result = await places.getPlaces({ only_highlighted: true })

      expect(result).toEqual({ data: [place], total: 1 })
    })
  })

  describe('and requesting places by ids', () => {
    beforeEach(() => {
      placesRepository.findWithAggregates.mockResolvedValueOnce([])
    })

    it('should query the repository with the ids filter', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, logs })
      await places.getPlacesByIds(['a', 'b'], '0xUSER')

      expect(placesRepository.findWithAggregates).toHaveBeenCalledWith(
        pg,
        expect.objectContaining({ ids: ['a', 'b'], user: '0xUSER' })
      )
    })
  })

  describe('and requesting places by an empty id list', () => {
    it('should short-circuit without querying the repository', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, logs })
      const result = await places.getPlacesByIds([])

      expect(result).toEqual([])
      expect(placesRepository.findWithAggregates).not.toHaveBeenCalled()
    })
  })
})
