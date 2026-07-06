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
      expect(place).toEqual(
        expect.objectContaining({ base_position: '10,20', title: 'My Scene', owner: '0xdeployer', categories: ['art'] })
      )
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
  })

  describe('and a non-scene entity is deployed', () => {
    it('should skip it', async () => {
      const event = sceneDeployment('0,0', 'x')
      event.entity.type = 'profile'
      const result = await components.ingestion.processCatalystDeployment(event)

      expect(result.processed).toBe(false)
    })
  })
})
