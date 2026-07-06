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

  describe('and requesting event categories', () => {
    beforeEach(() => {
      categoriesRepository.findActiveEventCategories.mockResolvedValueOnce(['art', 'music'])
    })

    it('should return the active event category names', async () => {
      const categories = await createCategoriesComponent({ pg, categoriesRepository, dclListsClient, logs })
      const result = await categories.getEventCategories()

      expect(result).toEqual(['art', 'music'])
    })
  })
})
