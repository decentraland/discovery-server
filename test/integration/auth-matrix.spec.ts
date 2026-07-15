import SQL from 'sql-template-strings'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { ProfilePermission } from '../../src/types/entities'
import { test } from '../components'

// Configure the admin + data-team bearer secrets before this file's runner boots
// (module-level, so initComponents reads them). Harmless if they leak to later
// suites — those never send these headers.
process.env.API_ADMIN_TOKEN = 'test-admin-token'
process.env.DATA_TEAM_AUTH_TOKEN = 'test-data-team-token'

const ADMIN_BEARER = { authorization: 'Bearer test-admin-token' }
const DATA_TEAM_BEARER = { authorization: 'Bearer test-data-team-token' }

test('when exercising the auth matrix', function ({ components }) {
  let placeId: string

  beforeEach(async () => {
    await components.pg.query(SQL`DELETE FROM places`)
    await components.pg.query(SQL`DELETE FROM profile_settings`)
    const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '0,0' })
    placeId = place.id
  })

  describe('and calling an optional-signed read route (GET /api/events)', () => {
    it('should allow an anonymous request', async () => {
      const response = await components.localFetch.fetch('/api/events')
      expect(response.status).toBe(200)
    })
  })

  describe('and calling a signed-required route anonymously (POST /api/events)', () => {
    it('should reject the unsigned request with a 400', async () => {
      // signed-fetch treats a missing/invalid signature as a bad request.
      const response = await components.localFetch.fetch('/api/events', { method: 'POST', body: '{}' })
      expect(response.status).toBe(400)
    })
  })

  describe('and calling a moderation route (PUT /api/places/:id/rating)', () => {
    describe('and the caller is a signed non-admin wallet', () => {
      it('should respond with a 403', async () => {
        const identity = await getIdentity()
        const path = `/api/places/${placeId}/rating`
        const headers = getSignedAuthHeaders('PUT', path, {}, identity)
        const response = await components.localFetch.fetch(path, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ rating: 'R' })
        })
        expect(response.status).toBe(403)
      })
    })

    describe('and the caller presents a valid admin bearer', () => {
      it('should allow the moderation action', async () => {
        const path = `/api/places/${placeId}/rating`
        const response = await components.localFetch.fetch(path, {
          method: 'PUT',
          headers: ADMIN_BEARER,
          body: JSON.stringify({ rating: 'R' })
        })
        expect(response.status).toBe(200)
      })
    })

    describe('and the caller presents an invalid bearer', () => {
      it('should respond with a 401', async () => {
        const path = `/api/places/${placeId}/rating`
        const response = await components.localFetch.fetch(path, {
          method: 'PUT',
          headers: { authorization: 'Bearer wrong-token' },
          body: JSON.stringify({ rating: 'R' })
        })
        expect(response.status).toBe(401)
      })
    })
  })

  describe('and calling the ranking route (PUT /api/places/:id/ranking)', () => {
    let response: Awaited<ReturnType<typeof components.localFetch.fetch>>

    describe('and the caller presents a valid data-team bearer', () => {
      beforeEach(async () => {
        response = await components.localFetch.fetch(`/api/places/${placeId}/ranking`, {
          method: 'PUT',
          headers: DATA_TEAM_BEARER,
          body: JSON.stringify({ ranking: 5 })
        })
      })

      it('should allow the ranking update', () => {
        expect(response.status).toBe(200)
      })
    })

    describe('and the caller presents a valid admin bearer', () => {
      beforeEach(async () => {
        response = await components.localFetch.fetch(`/api/places/${placeId}/ranking`, {
          method: 'PUT',
          headers: ADMIN_BEARER,
          body: JSON.stringify({ ranking: 5 })
        })
      })

      // places #850 — ranking now accepts the service admin bearer, not only the data-team token.
      it('should also allow the ranking update', () => {
        expect(response.status).toBe(200)
      })
    })

    describe('and the caller presents an unknown bearer', () => {
      beforeEach(async () => {
        response = await components.localFetch.fetch(`/api/places/${placeId}/ranking`, {
          method: 'PUT',
          headers: { authorization: 'Bearer wrong-token' },
          body: JSON.stringify({ ranking: 5 })
        })
      })

      it('should respond with a 401', () => {
        expect(response.status).toBe(401)
      })
    })
  })

  describe('and calling the disable route (PUT /api/places/:id/disable)', () => {
    let response: Awaited<ReturnType<typeof components.localFetch.fetch>>

    describe('and the caller presents a valid admin bearer', () => {
      beforeEach(async () => {
        response = await components.localFetch.fetch(`/api/places/${placeId}/disable`, {
          method: 'PUT',
          headers: ADMIN_BEARER,
          body: JSON.stringify({ disabled: true })
        })
      })

      it('should allow the disable action', () => {
        expect(response.status).toBe(200)
      })
    })

    describe('and the caller is a signed non-admin wallet', () => {
      beforeEach(async () => {
        const identity = await getIdentity()
        const path = `/api/places/${placeId}/disable`
        response = await components.localFetch.fetch(path, {
          method: 'PUT',
          headers: getSignedAuthHeaders('PUT', path, {}, identity),
          body: JSON.stringify({ disabled: true })
        })
      })

      it('should respond with a 403', () => {
        expect(response.status).toBe(403)
      })
    })
  })

  describe('and calling a permission-gated route (POST /api/schedules)', () => {
    const scheduleBody = () =>
      JSON.stringify({
        name: 'S',
        active_since: new Date().toISOString(),
        active_until: new Date(Date.now() + 86_400_000).toISOString()
      })

    it('should forbid a signed wallet without edit_any_schedule', async () => {
      const identity = await getIdentity()
      const headers = getSignedAuthHeaders('POST', '/api/schedules', {}, identity)
      const response = await components.localFetch.fetch('/api/schedules', {
        method: 'POST',
        headers,
        body: scheduleBody()
      })
      expect(response.status).toBe(403)
    })

    it('should allow a signed wallet granted edit_any_schedule', async () => {
      const identity = await getIdentity()
      await components.profileSettingsRepository.upsertPermissions(
        components.pg,
        identity.realAccount.address.toLowerCase(),
        [ProfilePermission.EditAnySchedule]
      )
      const headers = getSignedAuthHeaders('POST', '/api/schedules', {}, identity)
      const response = await components.localFetch.fetch('/api/schedules', {
        method: 'POST',
        headers,
        body: scheduleBody()
      })
      expect(response.status).toBe(201)
    })
  })
})
