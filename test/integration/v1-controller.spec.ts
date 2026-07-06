import SQL from 'sql-template-strings'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { test } from '../components'

test('when serving the v1 discovery layer', function ({ components }) {
  describe('and a place, a world and an event exist', () => {
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`DELETE FROM places`)
      await components.pg.query(SQL`DELETE FROM worlds`)
      const place = await components.placesRepository.insert(components.pg, {
        title: 'Genesis Plaza',
        base_position: '0,0',
        positions: ['0,0'],
        owner: '0xabc',
        categories: ['art']
      })
      placeId = place.id
      await components.worldsRepository.upsert(components.pg, {
        id: 'my-world.dcl.eth',
        world_name: 'my-world.dcl.eth',
        show_in_places: true
      })
      await components.pg.query(SQL`
        INSERT INTO events (name, start_at, finish_at, duration, "user", approved, place_id, next_start_at, next_finish_at)
        VALUES ('Upcoming', now() + interval '1 hour', now() + interval '2 hours', 3600000, '0xowner', true, ${placeId},
                now() + interval '1 hour', now() + interval '2 hours')`)
    })

    describe('and requesting GET /v1/destinations/:id', () => {
      it('should return the destination decorated with its next event', async () => {
        const response = await components.localFetch.fetch(`/v1/destinations/${placeId}?with=next_event`)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data).toEqual(expect.objectContaining({ id: placeId, kind: 'place' }))
        expect(body.data.next_event).toEqual(expect.objectContaining({ name: 'Upcoming' }))
      })

      it('should respond with a 404 for an unknown destination', async () => {
        const response = await components.localFetch.fetch('/v1/destinations/11111111-1111-4111-8111-111111111111')

        expect(response.status).toBe(404)
      })
    })

    describe('and requesting GET /v1/destinations/:id/events', () => {
      it('should return the events at that destination', async () => {
        const response = await components.localFetch.fetch(`/v1/destinations/${placeId}/events`)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data.map((e: any) => e.name)).toEqual(['Upcoming'])
      })
    })

    describe('and requesting GET /v1/events/:event_id', () => {
      it('should embed the destination id and summary', async () => {
        const { rows } = await components.pg.query<{ id: string }>(SQL`SELECT id FROM events LIMIT 1`)
        const response = await components.localFetch.fetch(`/v1/events/${rows[0].id}`)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data.destination_id).toBe(placeId)
        expect(body.data.destination).toEqual(expect.objectContaining({ id: placeId }))
      })
    })

    describe('and requesting GET /v1/categories', () => {
      it('should return destination categories by default', async () => {
        const response = await components.localFetch.fetch('/v1/categories?target=destinations')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data.some((c: any) => c.name === 'art')).toBe(true)
      })
    })

    describe('and favoriting a destination via PATCH /v1/destinations/:id/favorite', () => {
      let identity: Awaited<ReturnType<typeof getIdentity>>

      beforeEach(async () => {
        await components.pg.query(SQL`DELETE FROM user_favorites`)
        identity = await getIdentity()
      })

      it('should record the favorite and echo the refreshed summary', async () => {
        const path = `/v1/destinations/${placeId}/favorite`
        const headers = getSignedAuthHeaders('PATCH', path, {}, identity)
        const response = await components.localFetch.fetch(path, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ favorite: true })
        })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data.user_favorite).toBe(true)
        expect(body.data.favorites).toBe(1)
      })

      it('should reject a body that fails schema validation with a 400', async () => {
        const path = `/v1/destinations/${placeId}/favorite`
        const headers = getSignedAuthHeaders('PATCH', path, {}, identity)
        const response = await components.localFetch.fetch(path, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ favorite: 'yes' })
        })

        expect(response.status).toBe(400)
      })
    })
  })
})
