import SQL from 'sql-template-strings'
import { Events } from '@dcl/schemas'
import { test } from '../components'

function sceneDeployment(base: string, title: string): any {
  return {
    type: Events.Type.CATALYST_DEPLOYMENT,
    subType: Events.SubType.CatalystDeployment.SCENE,
    key: `key-${base}`,
    timestamp: Date.now(),
    entity: {
      version: 'v3',
      id: `bafy-${base}`,
      type: 'scene',
      pointers: [base],
      timestamp: Date.now(),
      content: [],
      metadata: {
        scene: { base, parcels: [base] },
        display: { title, description: 'A scene' },
        contact: { name: 'creator' },
        owner: '0xSceneOwner',
        creator: '0xSceneCreator',
        runtimeVersion: '7',
        tags: ['art']
      }
    },
    authChain: [{ type: 'SIGNER', payload: '0xDEPLOYER', signature: '' }]
  }
}

test('when ingesting Catalyst scene deployments', function ({ components }) {
  describe('and a new scene is deployed', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
    })

    it('should upsert a place with the scene data', async () => {
      const result = await components.ingestion.processCatalystDeployment(sceneDeployment('10,20', 'My Scene'))

      expect(result.processed).toBe(true)
      const place = await components.placesRepository.findByIdWithAggregates(components.pg, result.placeId!)
      // owner/creator come from the scene metadata (not the deployer wallet); sdk from runtimeVersion.
      expect(place).toEqual(
        expect.objectContaining({
          base_position: '10,20',
          title: 'My Scene',
          owner: '0xsceneowner',
          creator_address: '0xscenecreator',
          sdk: '7',
          categories: ['art']
        })
      )
    })

    it('should build a textsearch vector so the place is findable by search', async () => {
      const result = await components.ingestion.processCatalystDeployment(sceneDeployment('12,22', 'Searchable Scene'))

      const { rows } = await components.pg.query<{ n: string }>(SQL`
        SELECT count(*) AS n FROM places
        WHERE id = ${result.placeId}::uuid AND textsearch @@ websearch_to_tsquery('english', 'searchable')`)
      expect(Number(rows[0].n)).toBe(1)
    })
  })

  describe('and the same scene is re-deployed', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      await components.ingestion.processCatalystDeployment(sceneDeployment('30,40', 'Original'))
      await components.ingestion.processCatalystDeployment(sceneDeployment('30,40', 'Renamed'))
    })

    it('should update the existing place rather than create a duplicate', async () => {
      const count = await components.pg.query<{ n: string }>(
        SQL`SELECT count(*) AS n FROM places WHERE base_position = '30,40'`
      )
      expect(Number(count.rows[0].n)).toBe(1)
    })

    it('should reflect the latest title', async () => {
      const place = await components.pg.query<{ title: string }>(
        SQL`SELECT title FROM places WHERE base_position = '30,40'`
      )
      expect(place.rows[0].title).toBe('Renamed')
    })

    it('should preserve the selected place id without changing an unrelated place', async () => {
      await components.pg.query(SQL`
        INSERT INTO places (id, title, base_position, positions, deployed_at, disabled)
        VALUES (gen_random_uuid(), 'Unrelated', '31,41', '{"31,41"}', now() - interval '1 hour', false)`)
      const selected = await components.pg.query<{ id: string }>(
        SQL`SELECT id FROM places WHERE base_position = '30,40'`
      )
      await components.ingestion.processCatalystDeployment(sceneDeployment('30,40', 'Updated Again'))
      const places = await components.pg.query<{ id: string; base_position: string; title: string }>(SQL`
        SELECT id, base_position, title FROM places WHERE base_position IN ('30,40', '31,41') ORDER BY base_position`)

      expect(places.rows).toEqual([
        { id: selected.rows[0].id, base_position: '30,40', title: 'Updated Again' },
        { id: expect.any(String), base_position: '31,41', title: 'Unrelated' }
      ])
    })
  })

  describe('and the scene base differs from its authorized pointers', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      await components.ingestion.processCatalystDeployment(sceneDeployment('50,60', 'Victim'))
    })

    it('should reject the deployment without changing the victim row', async () => {
      const event = sceneDeployment('10,20', 'Forged')
      event.entity.metadata.scene.base = '50,60'
      const result = await components.ingestion.processCatalystDeployment(event)
      const victim = await components.pg.query<{ title: string }>(SQL`
        SELECT title FROM places WHERE base_position = '50,60'`)

      expect({ processed: result.processed, title: victim.rows[0].title }).toEqual({
        processed: false,
        title: 'Victim'
      })
    })
  })

  describe('and deployment history contains repeated deployment ids', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      await components.pg.query(SQL`
        INSERT INTO places (id, deployment_id, title, base_position, positions, deployed_at, disabled)
        VALUES
          (gen_random_uuid(), 'repeated-deployment', 'Old', '70,80', '{"70,80"}', now() - interval '2 hours', true),
          (gen_random_uuid(), 'repeated-deployment', 'Current', '70,80', '{"70,80"}', now() - interval '1 hour', false)`)
    })

    it('should retain both historical rows under the deployment lookup index', async () => {
      const result = await components.pg.query<{ total: string }>(SQL`
        SELECT count(*) AS total FROM places WHERE deployment_id = 'repeated-deployment'`)

      expect(Number(result.rows[0].total)).toBe(2)
    })
  })

  describe('and a non-scene entity is deployed', () => {
    it('should skip it', async () => {
      const event = sceneDeployment('0,0', 'x')
      event.entity.type = 'profile'
      const result = await components.ingestion.processCatalystDeployment(event)

      expect(result.processed).toBe(false)
    })
  })

  describe('and a world settings-changed event is ingested', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM worlds WHERE id = 'ingested-world.dcl.eth'`)
    })

    it('should upsert a visible world row', async () => {
      const result = await components.ingestion.processWorldSettingsChanged({
        metadata: {
          worldName: 'ingested-world.dcl.eth',
          title: 'Ingested World',
          contentRating: 'T',
          showInPlaces: true,
          accessType: 'unrestricted'
        }
      } as any)

      expect(result.processed).toBe(true)
      const world = await components.worldsRepository.findByIdWithAggregates(components.pg, 'ingested-world.dcl.eth')
      expect(world).toEqual(
        expect.objectContaining({ id: 'ingested-world.dcl.eth', title: 'Ingested World', show_in_places: true })
      )
    })

    it('should not clobber an existing owner when the event omits it', async () => {
      await components.worldsRepository.upsert(components.pg, {
        id: 'ingested-world.dcl.eth',
        world_name: 'ingested-world.dcl.eth',
        owner: '0xexistingowner'
      })
      await components.ingestion.processWorldSettingsChanged({
        metadata: { worldName: 'ingested-world.dcl.eth', title: 'Renamed' }
      } as any)

      const world = await components.worldsRepository.findByIdWithAggregates(components.pg, 'ingested-world.dcl.eth')
      expect(world).toEqual(expect.objectContaining({ owner: '0xexistingowner', title: 'Renamed' }))
    })
  })

  describe('and a world scenes-undeployment event is ingested', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places WHERE world_id = 'undeploy-world.dcl.eth'`)
      await components.pg.query(SQL`DELETE FROM worlds WHERE id = 'undeploy-world.dcl.eth'`)
      await components.pg.query(SQL`
        INSERT INTO worlds (id, world_name, show_in_places) VALUES ('undeploy-world.dcl.eth', 'undeploy-world.dcl.eth', true)`)
      await components.pg.query(SQL`
        INSERT INTO places (id, title, owner, base_position, positions, world, world_id, deployed_at, disabled)
        VALUES (gen_random_uuid(), 'World scene', '0xowner', '5,5', '{"5,5"}', true, 'undeploy-world.dcl.eth',
                now() - interval '1 hour', false)`)
    })

    it('should disable the undeployed world places', async () => {
      await components.ingestion.processWorldScenesUndeployment({
        timestamp: Date.now(),
        metadata: { worldName: 'undeploy-world.dcl.eth', scenes: [{ entityId: 'e1', baseParcel: '5,5' }] }
      } as any)

      const { rows } = await components.pg.query<{ disabled: boolean }>(
        SQL`SELECT disabled FROM places WHERE world_id = 'undeploy-world.dcl.eth'`
      )
      expect(rows[0].disabled).toBe(true)
    })

    it('should prefer the exact deployment id over an unrelated supplied base parcel', async () => {
      await components.pg.query(SQL`
        UPDATE places SET deployment_id = 'victim-deployment' WHERE world_id = 'undeploy-world.dcl.eth';
        INSERT INTO places (
          id, deployment_id, title, owner, base_position, positions, world, world_id, deployed_at, disabled
        ) VALUES (
          gen_random_uuid(), 'attacker-deployment', 'Attacker scene', '0xowner', '6,6', '{"6,6"}', true,
          'undeploy-world.dcl.eth', now() - interval '1 hour', false
        )`)

      await components.ingestion.processWorldScenesUndeployment({
        timestamp: Date.now(),
        metadata: {
          worldName: 'undeploy-world.dcl.eth',
          scenes: [{ entityId: 'attacker-deployment', baseParcel: '5,5' }]
        }
      } as any)
      const places = await components.pg.query<{ deployment_id: string; disabled: boolean }>(SQL`
        SELECT deployment_id, disabled FROM places
        WHERE world_id = 'undeploy-world.dcl.eth' ORDER BY deployment_id`)

      expect(places.rows).toEqual([
        { deployment_id: 'attacker-deployment', disabled: true },
        { deployment_id: 'victim-deployment', disabled: false }
      ])
    })
  })
})
