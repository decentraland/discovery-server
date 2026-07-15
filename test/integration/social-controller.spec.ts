import SQL from 'sql-template-strings'
import { test } from '../components'

test('when serving link-preview HTML', function ({ components }) {
  describe('and a place exists', () => {
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      const place = await components.placesRepository.insert(components.pg, {
        title: 'Genesis Plaza',
        description: 'The heart of Decentraland',
        base_position: '0,0'
      })
      placeId = place.id
    })

    it('should render Open Graph meta tags with the place title', async () => {
      const response = await components.localFetch.fetch(`/places/place/?id=${placeId}`)
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(body).toContain('<meta property="og:title" content="Genesis Plaza"/>')
    })
  })

  describe('and the place does not exist', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
    })

    it('should still render a generic card with a 200', async () => {
      const response = await components.localFetch.fetch('/places/place/?id=00000000-0000-0000-0000-000000000000')
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(body).toContain('og:title')
    })
  })
})
