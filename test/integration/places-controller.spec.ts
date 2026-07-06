import SQL from 'sql-template-strings'
import { test } from '../components'

test('when reading places from a real server', function ({ components }) {
  describe('and places exist', () => {
    let genesisId: string
    let highlightedId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      const genesis = await components.placesRepository.insert(components.pg, {
        title: 'Genesis Plaza',
        base_position: '0,0',
        positions: ['0,0'],
        owner: '0xABC',
        categories: ['art']
      })
      genesisId = genesis.id
      const highlighted = await components.placesRepository.insert(components.pg, {
        title: 'Featured Spot',
        base_position: '10,10',
        positions: ['10,10'],
        highlighted: true
      })
      highlightedId = highlighted.id
    })

    it('should list the places with a total count', async () => {
      const response = await components.localFetch.fetch('/api/places')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.total).toBe(2)
      expect(body.data.map((p: { id: string }) => p.id).sort()).toEqual([genesisId, highlightedId].sort())
    })

    it('should filter to only highlighted places', async () => {
      const response = await components.localFetch.fetch('/api/places?only_highlighted=true')
      const body = await response.json()

      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(highlightedId)
    })

    it('should return a single place with default user flags', async () => {
      const response = await components.localFetch.fetch(`/api/places/${genesisId}`)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(
        expect.objectContaining({ id: genesisId, title: 'Genesis Plaza', user_like: false, user_favorite: false })
      )
    })

    it('should return places by ids via POST', async () => {
      const response = await components.localFetch.fetch('/api/places', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [genesisId] })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(genesisId)
    })

    it('should return status rows by ids via POST', async () => {
      const response = await components.localFetch.fetch('/api/places/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [genesisId, highlightedId] })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toHaveLength(2)
      expect(body.data[0]).toEqual(
        expect.objectContaining({ id: expect.any(String), base_position: expect.any(String) })
      )
    })
  })

  describe('and requesting a place that does not exist', () => {
    it('should respond with a 404', async () => {
      const response = await components.localFetch.fetch('/api/places/00000000-0000-0000-0000-000000000000')

      expect(response.status).toBe(404)
    })
  })

  describe('and requesting a place with a non-uuid id', () => {
    it('should respond with a 404 rather than a 500', async () => {
      const response = await components.localFetch.fetch('/api/places/not-a-uuid')

      expect(response.status).toBe(404)
    })
  })

  describe('and requesting status for malformed ids', () => {
    it('should ignore non-uuid ids instead of erroring', async () => {
      const response = await components.localFetch.fetch('/api/places/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ['not-a-uuid'] })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual([])
    })
  })

  describe('and requesting only_favorites without authentication', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      await components.placesRepository.insert(components.pg, { title: 'Public', base_position: '0,0' })
    })

    it('should return an empty list rather than the full catalog', async () => {
      const response = await components.localFetch.fetch('/api/places?only_favorites=true')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.total).toBe(0)
    })
  })
})
