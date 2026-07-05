import { createInteractionsComponent } from '../../src/logic/interactions'
import type { IInteractionsRepository } from '../../src/adapters/interactions-repository'

describe('when recording interactions', () => {
  let interactionsRepository: jest.Mocked<IInteractionsRepository>
  let pg: any
  let tx: any
  let logs: any

  beforeEach(() => {
    tx = { query: jest.fn() }
    pg = { withTransaction: jest.fn((cb: (client: any) => Promise<unknown>) => cb(tx)) }
    interactionsRepository = {
      setLike: jest.fn(),
      setFavorite: jest.fn(),
      recomputeLikes: jest.fn(),
      recomputeFavorites: jest.fn()
    }
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and liking a place', () => {
    beforeEach(async () => {
      const interactions = await createInteractionsComponent({ pg, interactionsRepository, logs })
      await interactions.setLike({ entityId: 'p1', entityType: 'place', user: '0xA', userActivity: 200, like: true })
    })

    it('should write the like on the transaction client', () => {
      expect(interactionsRepository.setLike).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ entityId: 'p1', entityType: 'place', user: '0xA', userActivity: 200, like: true })
      )
    })

    it('should recompute the like aggregates on the same transaction client', () => {
      expect(interactionsRepository.recomputeLikes).toHaveBeenCalledWith(tx, 'place', 'p1')
    })
  })

  describe('and favoriting a place without a supplied activity', () => {
    beforeEach(async () => {
      const interactions = await createInteractionsComponent({ pg, interactionsRepository, logs })
      await interactions.setFavorite({ entityId: 'p1', entityType: 'place', user: '0xA', favorite: true })
    })

    it('should default the user activity to zero', () => {
      expect(interactionsRepository.setFavorite).toHaveBeenCalledWith(tx, expect.objectContaining({ userActivity: 0 }))
    })

    it('should recompute the favorites count', () => {
      expect(interactionsRepository.recomputeFavorites).toHaveBeenCalledWith(tx, 'place', 'p1')
    })
  })
})
