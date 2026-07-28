import { createPlacesComponent, PlaceNotFoundError } from '../../src/logic/places'
import type { IPlacesRepository } from '../../src/adapters/places-repository'
import type { AggregatePlace } from '../../src/types/entities'

describe('when reading places', () => {
  let placesRepository: jest.Mocked<IPlacesRepository>
  let pg: any
  let hotScenes: any
  let sceneStats: any
  let catalystClient: any
  let logs: any

  beforeEach(() => {
    placesRepository = {
      lockById: jest.fn(),
      findByIdWithAggregates: jest.fn(),
      findByIds: jest.fn(),
      findWithAggregates: jest.fn(),
      count: jest.fn(),
      insert: jest.fn(),
      countByIds: jest.fn().mockResolvedValue(0),
      updateModeration: jest.fn(),
      findEnabledByPositions: jest.fn(),
      findActiveByWorldIdAndPositions: jest.fn(),
      insertScene: jest.fn(),
      updateScene: jest.fn(),
      disablePlaces: jest.fn(),
      disableByWorldId: jest.fn(),
      disableByWorldIdAndPositions: jest.fn(),
      listOccupiedPositions: jest.fn()
    }
    pg = {}
    hotScenes = {
      getUserCount: jest.fn().mockResolvedValue(0),
      getRealms: jest.fn().mockResolvedValue([]),
      getActivePositions: jest.fn().mockResolvedValue([]),
      refresh: jest.fn()
    }
    sceneStats = {
      getVisits: jest.fn().mockResolvedValue(0),
      getVisitsForPositions: jest.fn().mockResolvedValue(0),
      refresh: jest.fn()
    }
    catalystClient = { getOperatedPositions: jest.fn().mockResolvedValue([]) }
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
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })

      await expect(places.getPlace('missing')).rejects.toThrow(PlaceNotFoundError)
    })
  })

  describe('and listing places with with_realms_detail', () => {
    let place: AggregatePlace
    const realms = [{ serverName: 'realm-1', url: 'https://realm-1', usersCount: 4 }]

    beforeEach(() => {
      place = { id: 'p1', base_position: '0,0' } as AggregatePlace
      placesRepository.findWithAggregates.mockResolvedValue([place])
      placesRepository.count.mockResolvedValue(1)
      hotScenes.getRealms.mockResolvedValue(realms)
    })

    it('should decorate each place with realms_detail from hot-scenes', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      const result = await places.getPlaces({ withRealmsDetail: true })

      expect(hotScenes.getRealms).toHaveBeenCalledWith('0,0')
      expect(result.data[0].realms_detail).toEqual(realms)
    })

    it('should omit realms_detail when with_realms_detail is not requested', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      const result = await places.getPlaces({})

      expect(hotScenes.getRealms).not.toHaveBeenCalled()
      expect(result.data[0]).not.toHaveProperty('realms_detail')
    })
  })

  describe('and a stored place carries unsafe markup and image', () => {
    let place: AggregatePlace

    beforeEach(() => {
      place = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        base_position: '0,0',
        title: 'Cool <link="decentraland://x">Place</link>',
        description: 'Visit <link="decentraland://?position=0,0">here</link>',
        image: 'https://169.254.169.254/thumb.png',
        highlighted_image: 'javascript:alert(1)',
        contact_name: 'Owner <b>x</b>'
      } as AggregatePlace
      placesRepository.findByIdWithAggregates.mockResolvedValueOnce(place)
    })

    it('should strip the unsafe description markup on read', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      const result = await places.getPlace('123e4567-e89b-12d3-a456-426614174000')

      expect(result.description).toBe('Visit here')
    })

    it('should reduce the title to plain text on read', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      const result = await places.getPlace('123e4567-e89b-12d3-a456-426614174000')

      expect(result.title).toBe('Cool Place')
    })

    it('should reduce the contact name to plain text on read', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      const result = await places.getPlace('123e4567-e89b-12d3-a456-426614174000')

      expect(result.contact_name).toBe('Owner x')
    })

    it('should reject the internal-host image on read', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      const result = await places.getPlace('123e4567-e89b-12d3-a456-426614174000')

      expect(result.image).toBeNull()
    })

    it('should reject the unsafe highlighted_image on read', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      const result = await places.getPlace('123e4567-e89b-12d3-a456-426614174000')

      expect(result.highlighted_image).toBeNull()
    })
  })

  describe('and listing places', () => {
    let place: AggregatePlace

    beforeEach(() => {
      place = { id: 'p1', base_position: '0,0' } as AggregatePlace
      placesRepository.findWithAggregates.mockResolvedValueOnce([place])
      placesRepository.count.mockResolvedValueOnce(1)
    })

    it('should return the matching places, a total count, and decorated user_count/user_visits', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      const result = await places.getPlaces({ only_highlighted: true })

      expect(result).toEqual({
        data: [
          {
            ...place,
            title: null,
            description: null,
            image: null,
            highlighted_image: null,
            contact_name: null,
            user_count: 0,
            user_visits: 0
          }
        ],
        total: 1
      })
    })

    it('should resolve most_active positions from hot scenes when ordering by most_active', async () => {
      hotScenes.getActivePositions.mockResolvedValueOnce(['0,0', '1,1'])
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      await places.getPlaces({ order_by: 'most_active' })

      expect(placesRepository.findWithAggregates).toHaveBeenCalledWith(
        pg,
        expect.objectContaining({ order_by: 'most_active', mostActivePositions: ['0,0', '1,1'] })
      )
    })

    it('should expand an owner filter to the wallet operated parcels via Catalyst', async () => {
      catalystClient.getOperatedPositions.mockResolvedValueOnce(['10,10', '11,11'])
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      await places.getPlaces({ owner: '0xOWNER' })

      expect(catalystClient.getOperatedPositions).toHaveBeenCalledWith('0xOWNER')
      expect(placesRepository.findWithAggregates).toHaveBeenCalledWith(
        pg,
        expect.objectContaining({ owner: '0xOWNER', operatedPositions: ['10,10', '11,11'] })
      )
    })
  })

  describe('and requesting places by ids', () => {
    beforeEach(() => {
      placesRepository.findWithAggregates.mockResolvedValueOnce([])
    })

    it('should query the repository with the valid uuid ids filter', async () => {
      const ids = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      await places.getPlacesByIds([...ids, 'not-a-uuid'], { user: '0xUSER' })

      expect(placesRepository.findWithAggregates).toHaveBeenCalledWith(
        pg,
        expect.objectContaining({ ids, user: '0xUSER' })
      )
    })
  })

  describe('and requesting places by an empty id list', () => {
    it('should short-circuit without querying the repository', async () => {
      const places = await createPlacesComponent({ pg, placesRepository, hotScenes, sceneStats, catalystClient, logs })
      const result = await places.getPlacesByIds([])

      expect(result).toEqual({ data: [], total: 0 })
      expect(placesRepository.findWithAggregates).not.toHaveBeenCalled()
    })
  })
})
