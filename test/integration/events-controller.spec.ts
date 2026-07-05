import SQL from 'sql-template-strings'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { ProfilePermission } from '../../src/types/entities'
import { test } from '../components'

const HOUR_MS = 60 * 60 * 1000

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
})
