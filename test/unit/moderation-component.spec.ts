import { createModerationComponent } from '../../src/logic/moderation'
import { PlaceNotFoundError } from '../../src/logic/places'

describe('when moderating a place', () => {
  let components: any
  let tx: any

  beforeEach(() => {
    tx = { query: jest.fn() }
    components = {
      pg: { withTransaction: jest.fn((cb: (client: any) => Promise<unknown>) => cb(tx)) },
      placesRepository: { findByIdWithAggregates: jest.fn(), updateModeration: jest.fn() },
      worldsRepository: { findByIdWithAggregates: jest.fn(), updateModeration: jest.fn() },
      contentRatingsRepository: { record: jest.fn() },
      logs: { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and setting the content rating of an existing place', () => {
    beforeEach(() => {
      components.placesRepository.findByIdWithAggregates.mockResolvedValueOnce({ id: 'p1', content_rating: 'PR' })
      components.placesRepository.updateModeration.mockResolvedValueOnce({ id: 'p1', content_rating: 'R' })
    })

    it('should record the previous rating in the audit log', async () => {
      const moderation = await createModerationComponent(components)
      await moderation.setPlaceRating('p1', 'R', '0xMOD', 'inappropriate')

      expect(components.contentRatingsRepository.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ entityId: 'p1', originalRating: 'PR', updateRating: 'R', moderator: '0xMOD' })
      )
    })

    it('should update the place content rating', async () => {
      const moderation = await createModerationComponent(components)
      await moderation.setPlaceRating('p1', 'R', '0xMOD')

      expect(components.placesRepository.updateModeration).toHaveBeenCalledWith(tx, 'p1', { content_rating: 'R' })
    })
  })

  describe('and setting the content rating of a place that does not exist', () => {
    beforeEach(() => {
      components.placesRepository.findByIdWithAggregates.mockResolvedValueOnce(null)
    })

    it('should throw a PlaceNotFoundError', async () => {
      const moderation = await createModerationComponent(components)

      await expect(moderation.setPlaceRating('missing', 'R', '0xMOD')).rejects.toThrow(PlaceNotFoundError)
    })
  })

  describe('and disabling a place', () => {
    beforeEach(() => {
      components.placesRepository.updateModeration.mockResolvedValueOnce({ id: 'p1', disabled: true })
    })

    it('should update the place with a moderation disabled reason', async () => {
      const moderation = await createModerationComponent(components)
      await moderation.setPlaceDisabled('p1', true)

      expect(components.placesRepository.updateModeration).toHaveBeenCalledWith(components.pg, 'p1', {
        disabled: true,
        disabled_reason: 'moderation'
      })
    })
  })
})
