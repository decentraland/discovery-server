import SQL from 'sql-template-strings'
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
})
