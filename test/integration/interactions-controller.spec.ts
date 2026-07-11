import SQL from 'sql-template-strings'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { test } from '../components'

test('when writing interactions over signed-fetch routes', function ({ components }) {
  describe('and an authenticated user likes a place', () => {
    let placeId: string
    let identity: Awaited<ReturnType<typeof getIdentity>>

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM user_likes`)
      await components.pg.query(SQL`DELETE FROM places`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '0,0' })
      placeId = place.id
      identity = await getIdentity()
    })

    it('should record the like and return the updated summary', async () => {
      const path = `/api/places/${placeId}/likes`
      const headers = getSignedAuthHeaders('PATCH', path, {}, identity)
      const response = await components.localFetch.fetch(path, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ like: true })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(expect.objectContaining({ likes: 1, user_like: true, user_dislike: false }))
    })
  })

  describe('and the world likes endpoint receives a place uuid', () => {
    let identity: Awaited<ReturnType<typeof getIdentity>>

    beforeEach(async () => {
      identity = await getIdentity()
    })

    it('should reject it with a 400 directing the caller to the places route', async () => {
      const path = `/api/worlds/11111111-1111-4111-8111-111111111111/likes`
      const headers = getSignedAuthHeaders('PATCH', path, {}, identity)
      const response = await components.localFetch.fetch(path, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ like: true })
      })

      expect(response.status).toBe(400)
    })
  })

  describe('and liking a place that does not exist', () => {
    let identity: Awaited<ReturnType<typeof getIdentity>>

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM user_likes`)
      await components.pg.query(SQL`DELETE FROM places`)
      identity = await getIdentity()
    })

    it('should return 404 without leaving an orphan interaction row', async () => {
      const id = '11111111-1111-4111-8111-111111111111'
      const path = `/api/places/${id}/likes`
      const headers = getSignedAuthHeaders('PATCH', path, {}, identity)
      const response = await components.localFetch.fetch(path, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ like: true })
      })

      expect(response.status).toBe(404)
      const { rows } = await components.pg.query<{ n: string }>(
        SQL`SELECT count(*) AS n FROM user_likes WHERE entity_id = ${id}`
      )
      expect(Number(rows[0].n)).toBe(0)
    })
  })

  describe('and the request is not signed', () => {
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '0,0' })
      placeId = place.id
    })

    it('should reject the request with a signed-fetch error status', async () => {
      const response = await components.localFetch.fetch(`/api/places/${placeId}/likes`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ like: true })
      })

      // @dcl/crypto-middleware rejects a missing/invalid signature with a 400.
      expect(response.status).toBe(400)
    })
  })

  describe('and an authenticated user favorites a place', () => {
    let placeId: string
    let identity: Awaited<ReturnType<typeof getIdentity>>

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM user_favorites`)
      await components.pg.query(SQL`DELETE FROM places`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '2,2' })
      placeId = place.id
      identity = await getIdentity()
    })

    it('should record the favorite and return the updated summary', async () => {
      const path = `/api/places/${placeId}/favorites`
      const headers = getSignedAuthHeaders('PATCH', path, {}, identity)
      const response = await components.localFetch.fetch(path, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ favorites: true })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(expect.objectContaining({ favorites: 1, user_favorite: true }))
    })
  })
})
