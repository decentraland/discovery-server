import { createModerationComponent } from '../../src/logic/moderation'
import { PlaceNotFoundError } from '../../src/logic/places'

const PLACE_ID = '11111111-1111-4111-8111-111111111111'

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
      slackNotifier: { notify: jest.fn() },
      config: { getString: jest.fn().mockResolvedValue(undefined) },
      logs: { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and setting the content rating of an existing place', () => {
    beforeEach(() => {
      components.placesRepository.findByIdWithAggregates.mockResolvedValueOnce({ id: PLACE_ID, content_rating: 'PR' })
      components.placesRepository.updateModeration.mockResolvedValueOnce({ id: PLACE_ID, content_rating: 'R' })
    })

    it('should record the previous rating in the audit log against the canonical id', async () => {
      const moderation = await createModerationComponent(components)
      await moderation.setPlaceRating(PLACE_ID, 'R', '0xMOD', 'inappropriate')

      expect(components.contentRatingsRepository.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ entityId: PLACE_ID, originalRating: 'PR', updateRating: 'R', moderator: '0xMOD' })
      )
    })

    it('should update the place content rating', async () => {
      const moderation = await createModerationComponent(components)
      await moderation.setPlaceRating(PLACE_ID, 'R', '0xMOD')

      expect(components.placesRepository.updateModeration).toHaveBeenCalledWith(tx, PLACE_ID, { content_rating: 'R' })
    })

    it('should post a Slack alert about the rating change', async () => {
      const moderation = await createModerationComponent(components)
      await moderation.setPlaceRating(PLACE_ID, 'R', '0xMOD')

      expect(components.slackNotifier.notify).toHaveBeenCalledWith(
        expect.stringContaining('content rating changed'),
        undefined
      )
    })
  })

  describe('and setting the content rating of a place that does not exist', () => {
    beforeEach(() => {
      components.placesRepository.findByIdWithAggregates.mockResolvedValueOnce(null)
    })

    it('should throw a PlaceNotFoundError', async () => {
      const moderation = await createModerationComponent(components)

      await expect(moderation.setPlaceRating(PLACE_ID, 'R', '0xMOD')).rejects.toThrow(PlaceNotFoundError)
    })
  })

  describe('and the place id is not a valid uuid', () => {
    it('should throw a PlaceNotFoundError without touching the database', async () => {
      const moderation = await createModerationComponent(components)

      await expect(moderation.setPlaceRating('not-a-uuid', 'R', '0xMOD')).rejects.toThrow(PlaceNotFoundError)
      expect(components.placesRepository.findByIdWithAggregates).not.toHaveBeenCalled()
    })
  })

  describe('and disabling a place', () => {
    beforeEach(() => {
      components.placesRepository.updateModeration.mockResolvedValueOnce({ id: PLACE_ID, disabled: true })
    })

    it('should update the place with a moderation disabled reason', async () => {
      const moderation = await createModerationComponent(components)
      await moderation.setPlaceDisabled(PLACE_ID, true)

      expect(components.placesRepository.updateModeration).toHaveBeenCalledWith(components.pg, PLACE_ID, {
        disabled: true,
        disabled_reason: 'moderation'
      })
    })
  })
})
