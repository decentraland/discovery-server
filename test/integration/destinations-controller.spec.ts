import SQL from 'sql-template-strings'
import { test } from '../components'

test('when discovering destinations', function ({ components }) {
  describe('and both places and worlds exist', () => {
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`DELETE FROM places`)
      await components.pg.query(SQL`DELETE FROM worlds`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '0,0' })
      placeId = place.id
      await components.worldsRepository.upsert(components.pg, {
        id: 'my-world.dcl.eth',
        world_name: 'my-world.dcl.eth',
        title: 'My World',
        show_in_places: true
      })
    })

    it('should return a unified list of places and worlds with their kind', async () => {
      const response = await components.localFetch.fetch('/api/destinations')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.total).toBe(2)
      const kinds = body.data.map((d: { kind: string }) => d.kind).sort()
      expect(kinds).toEqual(['place', 'world'])
    })

    it('should filter to a single kind when requested', async () => {
      const response = await components.localFetch.fetch('/v1/destinations?kinds=world')
      const body = await response.json()

      expect(body.data).toHaveLength(1)
      expect(body.data[0]).toEqual(expect.objectContaining({ kind: 'world', world_name: 'my-world.dcl.eth' }))
    })

    it('should decorate destinations with a connected-user count when requested', async () => {
      const response = await components.localFetch.fetch('/api/destinations?with_connected_users=true')
      const body = await response.json()

      // comms-gatekeeper is unconfigured in tests, so counts resolve to 0 but the field is present.
      expect(body.data.every((d: { user_count?: number }) => d.user_count === 0)).toBe(true)
    })

    it('should decorate destinations with live-event flags when requested', async () => {
      await components.pg.query(SQL`
        INSERT INTO events (name, start_at, finish_at, duration, "user", approved, place_id, next_start_at, next_finish_at)
        VALUES ('Live', now() - interval '10 minutes', now() + interval '1 hour', 3600000, '0xowner', true,
                ${placeId}, now() - interval '10 minutes', now() + interval '1 hour')`)

      const response = await components.localFetch.fetch('/api/destinations?with_live_events=true')
      const body = await response.json()

      const place = body.data.find((d: { id: string }) => d.id === placeId)
      const world = body.data.find((d: { kind: string }) => d.kind === 'world')
      expect(place.live_event).toBe(true)
      expect(world.live_event).toBe(false)
    })
  })

  describe('and requesting destinations by ids', () => {
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      await components.pg.query(SQL`DELETE FROM worlds`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '5,5' })
      placeId = place.id
    })

    it('should return only the requested destinations', async () => {
      const response = await components.localFetch.fetch('/api/destinations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [placeId] })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(placeId)
    })
  })
})
