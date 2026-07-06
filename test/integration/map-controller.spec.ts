import SQL from 'sql-template-strings'
import { test } from '../components'

test('when serving the map endpoints on a real server', function ({ components }) {
  describe('and a genesis place and a world exist', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`DELETE FROM places`)
      await components.pg.query(SQL`DELETE FROM worlds`)
      await components.pg.query(SQL`
        INSERT INTO places (id, title, owner, base_position, positions, world, categories, disabled)
        VALUES (gen_random_uuid(), 'Genesis Plaza', '0xowner', '10,20', '{"10,20"}', false, '{art}', false)`)
      await components.pg.query(SQL`
        INSERT INTO worlds (id, world_name, owner, show_in_places)
        VALUES ('my-world.dcl.eth', 'my-world.dcl.eth', '0xowner', true)`)
    })

    describe('and requesting GET /api/map', () => {
      it('should return genesis places keyed by base position', async () => {
        const response = await components.localFetch.fetch('/api/map')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data['10,20']).toEqual(
          expect.objectContaining({ base_position: '10,20', title: 'Genesis Plaza', categories: ['art'] })
        )
      })

      it('should not include worlds in the keyed map feed', async () => {
        const response = await components.localFetch.fetch('/api/map')
        const body = await response.json()

        expect(Object.values(body.data).some((p: any) => p.base_position === '')).toBe(false)
      })
    })

    describe('and requesting GET /api/map/places', () => {
      it('should return the unified places+worlds list', async () => {
        const response = await components.localFetch.fetch('/api/map/places')
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data.some((d: any) => d.kind === 'place')).toBe(true)
        expect(body.data.some((d: any) => d.kind === 'world')).toBe(true)
      })
    })
  })
})
