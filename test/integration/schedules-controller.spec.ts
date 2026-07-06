import SQL from 'sql-template-strings'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { ProfilePermission } from '../../src/types/entities'
import { test } from '../components'

test('when working with schedules on a real server', function ({ components }) {
  describe('and an active schedule exists', () => {
    let scheduleId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM schedules`)
      const created = await components.schedulesRepository.create(components.pg, {
        name: 'Pride',
        description: 'Pride festival',
        image: null,
        theme: null,
        background: [],
        active: true,
        active_since: new Date(Date.now() - 86_400_000).toISOString(),
        active_until: new Date(Date.now() + 86_400_000).toISOString()
      })
      scheduleId = created.id
    })

    it('should list the active schedule', async () => {
      const response = await components.localFetch.fetch('/api/schedules')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: scheduleId, name: 'Pride' })]))
    })

    it('should return the schedule by id', async () => {
      const response = await components.localFetch.fetch(`/api/schedules/${scheduleId}`)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(expect.objectContaining({ id: scheduleId, name: 'Pride' }))
    })
  })

  describe('and requesting a schedule that does not exist', () => {
    it('should respond with a 404', async () => {
      const response = await components.localFetch.fetch('/api/schedules/00000000-0000-0000-0000-000000000000')

      expect(response.status).toBe(404)
    })
  })

  describe('and creating a schedule', () => {
    let identity: Awaited<ReturnType<typeof getIdentity>>
    let address: string
    let body: Record<string, unknown>

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM schedules`)
      await components.pg.query(SQL`DELETE FROM profile_settings`)
      identity = await getIdentity()
      address = identity.realAccount.address.toLowerCase()
      body = {
        name: 'MVFW',
        active_since: new Date().toISOString(),
        active_until: new Date(Date.now() + 86_400_000).toISOString()
      }
    })

    describe('and the wallet lacks the edit_any_schedule permission', () => {
      it('should respond with a 403', async () => {
        const path = '/api/schedules'
        const headers = getSignedAuthHeaders('POST', path, {}, identity)
        const response = await components.localFetch.fetch(path, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        })

        expect(response.status).toBe(403)
      })
    })

    describe('and the wallet holds the edit_any_schedule permission', () => {
      beforeEach(async () => {
        await components.profileSettingsRepository.upsertPermissions(components.pg, address, [
          ProfilePermission.EditAnySchedule
        ])
      })

      it('should create the schedule and respond with a 201', async () => {
        const path = '/api/schedules'
        const headers = getSignedAuthHeaders('POST', path, {}, identity)
        const response = await components.localFetch.fetch(path, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        })
        const created = await response.json()

        expect(response.status).toBe(201)
        expect(created.data).toEqual(expect.objectContaining({ name: 'MVFW', active: true }))
      })

      it('should update an existing schedule', async () => {
        const seeded = await components.schedulesRepository.create(components.pg, {
          name: 'Old',
          description: null,
          image: null,
          theme: null,
          background: [],
          active: true,
          active_since: new Date().toISOString(),
          active_until: new Date(Date.now() + 86_400_000).toISOString()
        })
        const path = `/api/schedules/${seeded.id}`
        const headers = getSignedAuthHeaders('PATCH', path, {}, identity)
        const response = await components.localFetch.fetch(path, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ name: 'Renamed', theme: 'pride_2023' })
        })
        const updated = await response.json()

        expect(response.status).toBe(200)
        expect(updated.data).toEqual(expect.objectContaining({ id: seeded.id, name: 'Renamed', theme: 'pride_2023' }))
      })
    })
  })
})
