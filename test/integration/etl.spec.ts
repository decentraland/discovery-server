import { Pool } from 'pg'
import { test } from '../components'
import { migratePlaces, migrateWorlds, type EtlPools } from '../../scripts/etl/migrate'

// The app runner migrates the target (public) schema. We stage minimal legacy
// source tables in separate schemas and point search_path-scoped pools at them,
// so the ETL transforms run against real Postgres without a second database.
test('when migrating legacy data with the ETL', function ({ components }) {
  const connectionString = process.env.PG_COMPONENT_PSQL_CONNECTION_STRING as string
  let pools: EtlPools

  beforeEach(async () => {
    await components.pg.query('DROP SCHEMA IF EXISTS legacy_places CASCADE')
    await components.pg.query('CREATE SCHEMA legacy_places')
    await components.pg.query('DELETE FROM places')
    await components.pg.query('DELETE FROM worlds')

    // Legacy tables use gatsby CHAR columns; owner is over-wide to force blank padding.
    await components.pg.query(`
      CREATE TABLE legacy_places.worlds (
        id text PRIMARY KEY, world_name text, title text, description text, image text, content_rating text,
        categories varchar(50)[], owner char(50), show_in_places boolean, single_player boolean,
        skybox_time integer, is_private boolean, likes integer, dislikes integer, favorites integer,
        like_rate real, like_score real, highlighted boolean, highlighted_image text, ranking double precision,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
    await components.pg.query(`
      CREATE TABLE legacy_places.places (
        id char(36) PRIMARY KEY, title text, description text, image text, owner char(50), creator_address char(50),
        positions varchar(15)[], base_position varchar(15), contact_name text, contact_email text,
        content_rating varchar(4), likes integer, dislikes integer, favorites integer, like_rate real,
        like_score real, ranking double precision, highlighted boolean, highlighted_image text, disabled boolean,
        disabled_at timestamptz, disabled_reason varchar(20), world boolean, world_name text, world_id text,
        deployed_at timestamptz DEFAULT now(), categories varchar(50)[], sdk varchar(50),
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)

    await components.pg.query(`
      INSERT INTO legacy_places.worlds (id, world_name, content_rating, categories, owner, show_in_places,
        single_player, is_private, likes, dislikes, favorites, highlighted)
      VALUES ('my-world.dcl.eth', 'my-world.dcl.eth', 'RP', '{}', '0xowner', true, false, false, 0, 0, 0, false)`)
    await components.pg.query(`
      INSERT INTO legacy_places.places (id, title, owner, creator_address, positions, base_position,
        content_rating, likes, dislikes, favorites, highlighted, disabled, world, categories)
      VALUES ('11111111-1111-1111-1111-111111111111', 'Genesis Plaza', '0xabc', '0xabc', '{"0,0"}', '0,0',
        'PR', 0, 0, 0, false, false, false, '{art}')`)

    const source = new Pool({ connectionString, options: '-c search_path=legacy_places' })
    const target = new Pool({ connectionString })
    pools = { placesSource: source, eventsSource: source, target }
  })

  afterEach(async () => {
    await pools.placesSource.end()
    await pools.target.end()
    await components.pg.query('DROP SCHEMA IF EXISTS legacy_places CASCADE')
  })

  describe('and migrating worlds then places', () => {
    beforeEach(async () => {
      await migrateWorlds(pools)
      await migratePlaces(pools)
    })

    it('should cast the gatsby CHAR(36) id to a native uuid in the target', async () => {
      const result = await components.pg.query<{ id: string; title: string }>(
        `SELECT id, title FROM places WHERE base_position = '0,0'`
      )
      expect(result.rows[0]).toEqual({ id: '11111111-1111-1111-1111-111111111111', title: 'Genesis Plaza' })
    })

    it('should btrim the blank-padded owner column', async () => {
      const result = await components.pg.query<{ owner: string }>(
        `SELECT owner FROM places WHERE base_position = '0,0'`
      )
      expect(result.rows[0].owner).toBe('0xabc')
    })

    it('should load the world', async () => {
      const result = await components.pg.query<{ id: string }>(`SELECT id FROM worlds`)
      expect(result.rows[0].id).toBe('my-world.dcl.eth')
    })
  })
})
