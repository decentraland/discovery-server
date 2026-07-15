import { test } from '../components'

test('when requesting categories from a real server', function ({ components }) {
  describe('and requesting place categories', () => {
    it('should respond with a 200 and the seeded place categories with counts and i18n', async () => {
      const response = await components.localFetch.fetch('/api/categories')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.data).toEqual(expect.arrayContaining([{ name: 'art', count: 0, i18n: { en: '🎨 Art' } }]))
    })

    it('should include all 14 seeded place categories', async () => {
      const response = await components.localFetch.fetch('/api/categories')
      const body = await response.json()

      expect(body.data).toHaveLength(14)
    })
  })

  describe('and requesting event categories', () => {
    it('should respond with a 200 and the 25 seeded event tags with metadata and i18n labels', async () => {
      const response = await components.localFetch.fetch('/api/events/categories')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toHaveLength(25)
      expect(body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'art', active: true, i18n: { en: 'Art & Culture' } }),
          expect.objectContaining({ name: 'music', active: true, i18n: { en: 'Music' } }),
          expect.objectContaining({ name: 'gaming', active: true, i18n: { en: 'Gaming' } })
        ])
      )
    })
  })
})
