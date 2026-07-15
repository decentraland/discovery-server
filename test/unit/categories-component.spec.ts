import { createCategoriesComponent } from '../../src/logic/categories'
import type { ICategoriesRepository } from '../../src/adapters/categories-repository'

describe('when getting categories', () => {
  let categoriesRepository: jest.Mocked<ICategoriesRepository>
  let pg: any
  let dclListsClient: any
  let logs: any

  beforeEach(() => {
    categoriesRepository = {
      findActivePlaceCategories: jest.fn(),
      findActivePlaceCategoriesWithCounts: jest.fn(),
      findActiveEventCategories: jest.fn(),
      setPlaceCategories: jest.fn(),
      reconcilePoiCategory: jest.fn()
    }
    pg = {}
    dclListsClient = { getPois: jest.fn().mockResolvedValue([]) }
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and requesting place categories that have known labels', () => {
    beforeEach(() => {
      categoriesRepository.findActivePlaceCategoriesWithCounts.mockResolvedValueOnce([{ name: 'art', count: 3 }])
    })

    it('should decorate each category with its English i18n label', async () => {
      const categories = await createCategoriesComponent({ pg, categoriesRepository, dclListsClient, logs })
      const result = await categories.getPlaceCategories()

      expect(result).toEqual([{ name: 'art', count: 3, i18n: { en: '🎨 Art' } }])
    })
  })

  describe('and requesting place categories that have no known label', () => {
    beforeEach(() => {
      categoriesRepository.findActivePlaceCategoriesWithCounts.mockResolvedValueOnce([{ name: 'unmapped', count: 0 }])
    })

    it('should fall back to the category name as its label', async () => {
      const categories = await createCategoriesComponent({ pg, categoriesRepository, dclListsClient, logs })
      const result = await categories.getPlaceCategories()

      expect(result).toEqual([{ name: 'unmapped', count: 0, i18n: { en: 'unmapped' } }])
    })
  })

  describe('and requesting place categories scoped to worlds', () => {
    beforeEach(() => {
      categoriesRepository.findActivePlaceCategoriesWithCounts.mockResolvedValueOnce([])
    })

    it('should query the repository with the worlds scope', async () => {
      const categories = await createCategoriesComponent({ pg, categoriesRepository, dclListsClient, logs })
      await categories.getPlaceCategories('worlds')

      expect(categoriesRepository.findActivePlaceCategoriesWithCounts).toHaveBeenCalledWith(pg, 'worlds')
    })
  })

  describe('and syncing POIs', () => {
    describe('and dcl-lists returns positions', () => {
      beforeEach(() => {
        dclListsClient.getPois.mockResolvedValue(['10,20', '30,40'])
        pg.withTransaction = jest.fn((cb: (client: any) => Promise<unknown>) => cb(pg))
        categoriesRepository.reconcilePoiCategory.mockResolvedValue(2)
      })

      it('should reconcile the poi category with the returned positions', async () => {
        const categories = await createCategoriesComponent({ pg, categoriesRepository, dclListsClient, logs })
        await categories.syncPois()

        expect(categoriesRepository.reconcilePoiCategory).toHaveBeenCalledWith(pg, ['10,20', '30,40'])
      })
    })

    describe('and dcl-lists returns an empty list', () => {
      beforeEach(() => {
        dclListsClient.getPois.mockResolvedValue([])
        pg.withTransaction = jest.fn((cb: (client: any) => Promise<unknown>) => cb(pg))
      })

      it('should not reconcile so a transient outage cannot wipe every POI', async () => {
        const categories = await createCategoriesComponent({ pg, categoriesRepository, dclListsClient, logs })
        const result = await categories.syncPois()

        expect(result).toBe(0)
        expect(categoriesRepository.reconcilePoiCategory).not.toHaveBeenCalled()
        expect(pg.withTransaction).not.toHaveBeenCalled()
      })
    })
  })

  describe('and requesting event categories', () => {
    let createdAt: Date
    let updatedAt: Date

    beforeEach(() => {
      createdAt = new Date('2024-01-01T00:00:00.000Z')
      updatedAt = new Date('2024-02-01T00:00:00.000Z')
      categoriesRepository.findActiveEventCategories.mockResolvedValueOnce([
        { name: 'art', active: true, created_at: createdAt, updated_at: updatedAt },
        { name: 'music', active: true, created_at: createdAt, updated_at: updatedAt }
      ])
    })

    it('should return the active event categories decorated with English labels', async () => {
      const categories = await createCategoriesComponent({ pg, categoriesRepository, dclListsClient, logs })
      const result = await categories.getEventCategories()

      expect(result).toEqual([
        { name: 'art', active: true, created_at: createdAt, updated_at: updatedAt, i18n: { en: 'Art & Culture' } },
        { name: 'music', active: true, created_at: createdAt, updated_at: updatedAt, i18n: { en: 'Music' } }
      ])
    })
  })
})
