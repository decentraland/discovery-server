import SQL from 'sql-template-strings'
import { test } from '../components'

test('when reading worlds from a real server', function ({ components }) {
  describe('and worlds exist', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places WHERE world IS true`)
      await components.pg.query(SQL`DELETE FROM worlds`)
      await components.worldsRepository.upsert(components.pg, {
        id: 'my-world.dcl.eth',
        world_name: 'my-world.dcl.eth',
        title: 'My World',
        show_in_places: true
      })
      // A world is only listable when it has an enabled place (legacy parity).
      await components.pg.query(SQL`
        INSERT INTO places (id, title, base_position, positions, world, world_id, deployed_at, disabled)
        VALUES (gen_random_uuid(), 'My World', '0,0', '{"0,0"}', true, 'my-world.dcl.eth', now(), false)`)
      await components.worldsRepository.upsert(components.pg, {
        id: 'hidden.dcl.eth',
        world_name: 'hidden.dcl.eth',
        title: 'Hidden',
        show_in_places: false
      })
    })

    it('should list only worlds shown in places', async () => {
      const response = await components.localFetch.fetch('/api/worlds')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.total).toBe(1)
      expect(body.data[0].id).toBe('my-world.dcl.eth')
    })

    it('should return the world names shown in places', async () => {
      const response = await components.localFetch.fetch('/api/world_names')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(['my-world.dcl.eth'])
    })

    it('should return a single world by id, lowercasing the lookup', async () => {
      const response = await components.localFetch.fetch('/api/worlds/MY-WORLD.dcl.eth')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(expect.objectContaining({ id: 'my-world.dcl.eth', title: 'My World' }))
    })
  })

  describe('and requesting a world that does not exist', () => {
    it('should respond with a 404', async () => {
      const response = await components.localFetch.fetch('/api/worlds/nonexistent.dcl.eth')

      expect(response.status).toBe(404)
    })
  })
})
