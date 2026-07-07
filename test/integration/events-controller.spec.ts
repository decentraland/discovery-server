import SQL from 'sql-template-strings'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { ProfilePermission } from '../../src/types/entities'
import { test } from '../components'

const HOUR_MS = 60 * 60 * 1000

test('when moderating and viewing events', function ({ components }) {
  describe('and a pending event exists', () => {
    let owner: Awaited<ReturnType<typeof getIdentity>>
    let eventId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`DELETE FROM profile_settings`)
      owner = await getIdentity()
      const created = await components.events.createEvent(
        { name: 'Pending', start_at: new Date(Date.now() + HOUR_MS).toISOString(), duration: HOUR_MS, x: 0, y: 0 },
        owner.realAccount.address
      )
      eventId = created.id
    })

    it('should let the owner see their own pending event in the list', async () => {
      const path = '/api/events'
      const headers = getSignedAuthHeaders('GET', path, {}, owner)
      const body = await (await components.localFetch.fetch(path, { headers })).json()

      expect(body.data.map((e: { id: string }) => e.id)).toContain(eventId)
    })

    it('should hide the pending event from anonymous callers', async () => {
      const body = await (await components.localFetch.fetch('/api/events')).json()

      expect(body.total).toBe(0)
    })

    it('should let a moderator approve it via PATCH, making it public', async () => {
      const moderator = await getIdentity()
      await components.profileSettingsRepository.upsertPermissions(components.pg, moderator.realAccount.address, [
        ProfilePermission.ApproveAnyEvent
      ])
      const path = `/api/events/${eventId}`
      const headers = getSignedAuthHeaders('PATCH', path, {}, moderator)
      const response = await components.localFetch.fetch(path, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true })
      })

      expect(response.status).toBe(200)
      const list = await (await components.localFetch.fetch('/api/events')).json()
      expect(list.data.map((e: { id: string }) => e.id)).toContain(eventId)
    })
  })

  describe('and a world event exists', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`DELETE FROM worlds`)
      await components.worldsRepository.upsert(components.pg, {
        id: 'my-world.dcl.eth',
        world_name: 'my-world.dcl.eth',
        show_in_places: true
      })
      const owner = await getIdentity()
      // Grant self-approval so the event is public and anonymously fetchable.
      await components.profileSettingsRepository.upsertPermissions(components.pg, owner.realAccount.address, [
        ProfilePermission.ApproveOwnEvent
      ])
      await components.events.createEvent(
        {
          name: 'World event',
          start_at: new Date(Date.now() + HOUR_MS).toISOString(),
          duration: HOUR_MS,
          world: true,
          server: 'my-world.dcl.eth'
        },
        owner.realAccount.address
      )
    })

    it('should serve place_id as the world id (legacy contract)', async () => {
      const { rows } = await components.pg.query<{ id: string }>(SQL`SELECT id FROM events LIMIT 1`)
      const body = await (await components.localFetch.fetch(`/api/events/${rows[0].id}`)).json()

      expect(body.data.world).toBe(true)
      expect(body.data.place_id).toBe('my-world.dcl.eth')
      expect(body.data.world_id).toBe('my-world.dcl.eth')
    })
  })

  describe('and a finished event exists', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`
        INSERT INTO events (name, start_at, finish_at, duration, "user", approved, next_start_at, next_finish_at)
        VALUES ('Finished', now() - interval '3 hours', now() - interval '1 hour', 3600000, '0xowner', true,
                now() - interval '3 hours', now() - interval '1 hour')`)
    })

    it('should exclude it from the default (active) list', async () => {
      const body = await (await components.localFetch.fetch('/api/events')).json()
      expect(body.total).toBe(0)
    })

    it('should include it when list=all is requested', async () => {
      const body = await (await components.localFetch.fetch('/api/events?list=all')).json()
      expect(body.total).toBe(1)
    })
  })
})

test('when managing events over the API', function ({ components }) {
  describe('and an authenticated user creates an event at a known place', () => {
    let identity: Awaited<ReturnType<typeof getIdentity>>
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM event_attendees`)
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`DELETE FROM place_positions`)
      await components.pg.query(SQL`DELETE FROM places`)
      await components.pg.query(SQL`DELETE FROM profile_settings`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '0,0' })
      placeId = place.id
      await components.pg.query(SQL`INSERT INTO place_positions (position, base_position) VALUES ('0,0', '0,0')`)
      identity = await getIdentity()
    })

    it('should create a pending event resolving the place in-process', async () => {
      const path = '/api/events'
      const headers = getSignedAuthHeaders('POST', path, {}, identity)
      const response = await components.localFetch.fetch(path, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'My Party',
          start_at: new Date(Date.now() + HOUR_MS).toISOString(),
          duration: HOUR_MS,
          x: 0,
          y: 0
        })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(
        expect.objectContaining({ name: 'My Party', place_id: placeId, world: false, approved: false })
      )
    })

    it('should hide the pending event from the public list but show it to its owner', async () => {
      const createPath = '/api/events'
      const createHeaders = getSignedAuthHeaders('POST', createPath, {}, identity)
      const created = await (
        await components.localFetch.fetch(createPath, {
          method: 'POST',
          headers: { ...createHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Hidden',
            start_at: new Date(Date.now() + HOUR_MS).toISOString(),
            duration: HOUR_MS,
            x: 0,
            y: 0
          })
        })
      ).json()

      const publicList = await (await components.localFetch.fetch('/api/events')).json()
      expect(publicList.total).toBe(0)

      const getPath = `/api/events/${created.data.id}`
      const getHeaders = getSignedAuthHeaders('GET', getPath, {}, identity)
      const ownerView = await components.localFetch.fetch(getPath, { headers: getHeaders })
      expect(ownerView.status).toBe(200)
    })

    it('should materialize recurrent dates for a daily recurrence', async () => {
      const path = '/api/events'
      const headers = getSignedAuthHeaders('POST', path, {}, identity)
      const response = await components.localFetch.fetch(path, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Daily',
          start_at: new Date(Date.now() + HOUR_MS).toISOString(),
          duration: HOUR_MS,
          x: 0,
          y: 0,
          recurrent: true,
          recurrent_frequency: 'DAILY',
          recurrent_count: 5
        })
      })
      const body = await response.json()

      expect(body.data.recurrent).toBe(true)
      expect(body.data.recurrent_dates.length).toBeGreaterThan(1)
    })

    it('should create an approved event when the creator can approve their own events', async () => {
      await components.profileSettingsRepository.upsertPermissions(components.pg, identity.realAccount.address, [
        ProfilePermission.ApproveOwnEvent
      ])

      const path = '/api/events'
      const headers = getSignedAuthHeaders('POST', path, {}, identity)
      await components.localFetch.fetch(path, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Approved',
          start_at: new Date(Date.now() + HOUR_MS).toISOString(),
          duration: HOUR_MS,
          x: 0,
          y: 0
        })
      })

      const publicList = await (await components.localFetch.fetch('/api/events')).json()
      expect(publicList.total).toBe(1)
    })
  })

  describe('and a user attends an approved event', () => {
    let identity: Awaited<ReturnType<typeof getIdentity>>
    let eventId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM event_attendees`)
      await components.pg.query(SQL`DELETE FROM events`)
      identity = await getIdentity()
      const result = await components.pg.query<{ id: string }>(SQL`
        INSERT INTO events (name, start_at, finish_at, duration, "user", approved, next_start_at, next_finish_at)
        VALUES ('Live', now(), now() + interval '1 hour', 3600000, '0xowner', true, now(), now() + interval '1 hour')
        RETURNING id`)
      eventId = result.rows[0].id
    })

    it('should record attendance and reflect it in the attendee list', async () => {
      const path = `/api/events/${eventId}/attendees`
      const headers = getSignedAuthHeaders('POST', path, {}, identity)
      const response = await components.localFetch.fetch(path, { method: 'POST', headers })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toHaveLength(1)
    })

    it('should bump the denormalized total_attendees counter', async () => {
      const path = `/api/events/${eventId}/attendees`
      const headers = getSignedAuthHeaders('POST', path, {}, identity)
      await components.localFetch.fetch(path, { method: 'POST', headers })

      const event = await components.eventsRepository.findById(components.pg, eventId)
      expect(event!.total_attendees).toBe(1)
    })
  })

  describe('and filtering the events list', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`
        INSERT INTO worlds (id, world_name, show_in_places) VALUES ('w.dcl.eth', 'w.dcl.eth', true)
        ON CONFLICT (id) DO NOTHING`)
      await components.pg.query(SQL`
        INSERT INTO events (name, start_at, finish_at, duration, "user", approved, x, y, world, server, world_id,
          next_start_at, next_finish_at)
        VALUES ('Genesis', now() + interval '2 hours', now() + interval '3 hours', 3600000, '0xowner', true, 10, 20,
                false, null, null, now() + interval '2 hours', now() + interval '3 hours'),
               ('Worldy', now() + interval '1 hour', now() + interval '2 hours', 3600000, '0xowner', true, 0, 0,
                true, 'w.dcl.eth', 'w.dcl.eth', now() + interval '1 hour', now() + interval '2 hours')`)
    })

    it('should filter by position', async () => {
      const body = await (await components.localFetch.fetch('/api/events?positions=10,20')).json()
      expect(body.data.map((e: any) => e.name)).toEqual(['Genesis'])
    })

    it('should filter to worlds only with world=true', async () => {
      const body = await (await components.localFetch.fetch('/api/events?world=true')).json()
      expect(body.data.map((e: any) => e.name)).toEqual(['Worldy'])
    })

    it('should order by next_start_at descending with order=desc', async () => {
      const body = await (await components.localFetch.fetch('/api/events?order=desc')).json()
      expect(body.data.map((e: any) => e.name)).toEqual(['Genesis', 'Worldy'])
    })

    it('should reject only_attendee without authentication', async () => {
      const response = await components.localFetch.fetch('/api/events?only_attendee=true')
      expect(response.status).toBe(401)
    })
  })

  describe('and searching events by community via POST /api/events/search', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`
        INSERT INTO events (name, start_at, finish_at, duration, "user", approved, community_id,
          next_start_at, next_finish_at)
        VALUES ('Community party', now() + interval '1 hour', now() + interval '2 hours', 3600000, '0xowner', true,
                'community-1', now() + interval '1 hour', now() + interval '2 hours'),
               ('Other event', now() + interval '1 hour', now() + interval '2 hours', 3600000, '0xowner', true,
                null, now() + interval '1 hour', now() + interval '2 hours')`)
    })

    it('should return only the events for the requested community', async () => {
      const response = await components.localFetch.fetch('/api/events/search', {
        method: 'POST',
        body: JSON.stringify({ communityId: 'community-1' })
      })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].name).toBe('Community party')
    })

    it('should tolerate a missing body and return the active events', async () => {
      const response = await components.localFetch.fetch('/api/events/search', { method: 'POST' })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.total).toBe(2)
    })
  })
})
