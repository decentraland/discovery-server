import { createIngestionComponent } from '../../src/logic/ingestion'

describe('when ingesting deployment events', () => {
  let components: any

  beforeEach(() => {
    components = {
      pg: { withTransaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) },
      placesRepository: {
        findEnabledByPositions: jest.fn().mockResolvedValue([]),
        findActiveByWorldIdAndPositions: jest.fn().mockResolvedValue([]),
        findByIdWithAggregates: jest.fn().mockResolvedValue(null),
        insertScene: jest.fn().mockImplementation(async (_c: unknown, scene: any) => ({ id: 'place-1', ...scene })),
        updateScene: jest.fn().mockImplementation(async (_c: unknown, id: string, scene: any) => ({ id, ...scene })),
        disablePlaces: jest.fn().mockResolvedValue(0),
        disableByWorldId: jest.fn().mockResolvedValue(0),
        disableByWorldIdAndDeployments: jest.fn().mockResolvedValue(0)
      },
      worldsRepository: { findByIdWithAggregates: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      categoriesRepository: {
        findActivePlaceCategories: jest.fn().mockResolvedValue([]),
        setPlaceCategories: jest.fn()
      },
      contentRatingsRepository: { record: jest.fn() },
      subgraphsClient: { getNameOwner: jest.fn().mockResolvedValue(undefined) },
      catalystClient: { getEntityById: jest.fn().mockResolvedValue(null) },
      landClient: { getParcelImage: jest.fn((x: number, y: number) => `https://land/${x}/${y}.png`) },
      slackNotifier: { notify: jest.fn() },
      config: { getString: jest.fn().mockResolvedValue(undefined) },
      logs: { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and a genesis scene deployment arrives for a new position', () => {
    let event: any

    beforeEach(() => {
      components.categoriesRepository.findActivePlaceCategories.mockResolvedValue(['art'])
      event = {
        entity: {
          type: 'scene',
          pointers: ['10,20'],
          timestamp: 1_700_000_000_000,
          content: [{ file: 'thumb.png', hash: 'QmThumb' }],
          metadata: {
            scene: { base: '10,20', parcels: ['10,20'] },
            display: { title: 'Cool Scene', description: 'desc', navmapThumbnail: 'thumb.png' },
            policy: { contentRating: 'E' },
            contact: { name: 'author-name', email: 'a@example.com' },
            owner: '0xOWNER',
            creator: '0xCREATOR',
            runtimeVersion: '7',
            tags: ['art', 'poi']
          }
        }
      }
    })

    it('should insert the place resolving the thumbnail hash to a content URL', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processCatalystDeployment(event)

      expect(components.placesRepository.insertScene).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ image: 'https://peer.decentraland.org/content/contents/QmThumb', world: false })
      )
    })

    it('should map the legacy E rating to T', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processCatalystDeployment(event)

      expect(components.placesRepository.insertScene).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ content_rating: 'T' })
      )
    })

    it('should take sdk and creator from the scene metadata, not the deployer', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processCatalystDeployment(event)

      expect(components.placesRepository.insertScene).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sdk: '7', creator_address: '0xcreator' })
      )
    })

    it('should scrub the placeholder "author-name" contact to null', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processCatalystDeployment(event)

      expect(components.placesRepository.insertScene).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ contact_name: null })
      )
    })

    it('should assign only the valid, non-forbidden creator categories', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processCatalystDeployment(event)

      expect(components.categoriesRepository.setPlaceCategories).toHaveBeenCalledWith(expect.anything(), 'place-1', [
        'art'
      ])
    })

    it('should write a content-rating audit row for the new place', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processCatalystDeployment(event)

      expect(components.contentRatingsRepository.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ entityId: 'place-1', originalRating: null, updateRating: 'T' })
      )
    })
  })

  describe('and a genesis scene deployment has a title longer than 50 characters', () => {
    let event: any

    beforeEach(() => {
      event = {
        entity: {
          type: 'scene',
          pointers: ['1,1'],
          timestamp: 1_700_000_000_000,
          content: [],
          metadata: { scene: { base: '1,1', parcels: ['1,1'] }, display: { title: 'x'.repeat(80) } }
        }
      }
    })

    it('should truncate the title to 50 characters instead of dropping the deployment', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processCatalystDeployment(event)

      const scene = components.placesRepository.insertScene.mock.calls[0][1]
      expect(scene.title).toHaveLength(50)
    })
  })

  describe('and a genesis scene deployment is older than the existing place', () => {
    let event: any

    beforeEach(() => {
      components.placesRepository.findEnabledByPositions.mockResolvedValue([
        { id: 'place-1', base_position: '10,20', content_rating: 'T', deployed_at: '2024-01-01T00:00:00.000Z' }
      ])
      event = {
        entity: {
          type: 'scene',
          pointers: ['10,20'],
          timestamp: new Date('2023-01-01T00:00:00.000Z').getTime(),
          content: [],
          metadata: { scene: { base: '10,20', parcels: ['10,20'] }, display: { title: 'Old' } }
        }
      }
    })

    it('should skip the stale deployment without updating', async () => {
      const ingestion = await createIngestionComponent(components)
      const result = await ingestion.processCatalystDeployment(event)

      expect(result.processed).toBe(false)
      expect(components.placesRepository.updateScene).not.toHaveBeenCalled()
      expect(components.placesRepository.insertScene).not.toHaveBeenCalled()
    })
  })

  describe('and a scene base does not belong to the authorized pointers', () => {
    let event: any

    beforeEach(() => {
      event = {
        entity: {
          id: 'deployment-id',
          type: 'scene',
          pointers: ['10,20'],
          timestamp: 1_700_000_000_000,
          content: [],
          metadata: { scene: { base: '30,40', parcels: ['10,20'] }, display: { title: 'Invalid' } }
        }
      }
    })

    it('should reject the deployment before querying or writing places', async () => {
      const ingestion = await createIngestionComponent(components)
      const result = await ingestion.processCatalystDeployment(event)

      expect([
        result.processed,
        components.placesRepository.findEnabledByPositions.mock.calls.length,
        components.placesRepository.insertScene.mock.calls.length
      ]).toEqual([false, 0, 0])
    })
  })

  describe('and a genesis scene pointer uses a non-canonical coordinate', () => {
    let event: any
    let result: { processed: boolean }

    beforeEach(async () => {
      event = {
        entity: {
          id: 'deployment-id',
          type: 'scene',
          pointers: ['010,20'],
          timestamp: 1_700_000_000_000,
          content: [],
          metadata: { scene: { base: '10,20', parcels: ['10,20'] }, display: { title: 'Invalid' } }
        }
      }
      const ingestion = await createIngestionComponent(components)
      result = await ingestion.processCatalystDeployment(event)
    })

    it('should reject the deployment before querying or writing places', () => {
      expect([
        result.processed,
        components.placesRepository.findEnabledByPositions.mock.calls.length,
        components.placesRepository.insertScene.mock.calls.length
      ]).toEqual([false, 0, 0])
    })
  })

  describe('and a world scene deployment arrives via a Catalyst deployment', () => {
    let event: any

    beforeEach(() => {
      components.subgraphsClient.getNameOwner.mockResolvedValue('0xnameowner')
      event = {
        entity: {
          type: 'scene',
          pointers: ['0,0'],
          timestamp: 1_700_000_000_000,
          content: [],
          metadata: {
            scene: { base: '0,0', parcels: ['0,0'] },
            display: { title: 'World Scene' },
            worldConfiguration: { name: 'My-World.dcl.eth' }
          }
        }
      }
    })

    it('should upsert the world row with the on-chain name owner', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processCatalystDeployment(event)

      expect(components.worldsRepository.upsert).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'my-world.dcl.eth', owner: '0xnameowner', show_in_places: true })
      )
    })

    it('should insert the place flagged as a world with its world_id', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processCatalystDeployment(event)

      expect(components.placesRepository.insertScene).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ world: true, world_id: 'my-world.dcl.eth' })
      )
    })
  })

  describe('and a world settings-changed event arrives for a new world', () => {
    beforeEach(() => {
      components.subgraphsClient.getNameOwner.mockResolvedValue('0xowner')
    })

    it('should upsert the world with the resolved on-chain owner', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processWorldSettingsChanged({
        metadata: { worldName: 'My-World.dcl.eth', title: 'My World', showInPlaces: true, accessType: 'unrestricted' }
      })

      expect(components.subgraphsClient.getNameOwner).toHaveBeenCalledWith('My-World.dcl.eth')
      expect(components.worldsRepository.upsert).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({
          id: 'my-world.dcl.eth',
          title: 'My World',
          show_in_places: true,
          is_private: false,
          owner: '0xowner'
        })
      )
    })
  })

  describe('and a world settings-changed event would downgrade the content rating', () => {
    beforeEach(() => {
      components.worldsRepository.findByIdWithAggregates.mockResolvedValue({
        id: 'my-world.dcl.eth',
        content_rating: 'A',
        owner: '0xowner'
      })
    })

    it('should not write the downgraded rating', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processWorldSettingsChanged({ metadata: { worldName: 'my-world.dcl.eth', contentRating: 'E' } })

      const input = components.worldsRepository.upsert.mock.calls[0][1]
      expect(input.content_rating).toBeUndefined()
    })
  })

  describe('and a scenes-undeployment event arrives', () => {
    it('should disable the world places at the undeployed base positions', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processWorldScenesUndeployment({
        timestamp: 1_700_000_000_000,
        metadata: { worldName: 'My-World.dcl.eth', scenes: [{ entityId: 'e1', baseParcel: '0,0' }] }
      })

      expect(components.placesRepository.disableByWorldIdAndDeployments).toHaveBeenCalledWith(
        components.pg,
        'my-world.dcl.eth',
        ['e1'],
        ['0,0'],
        expect.any(Date)
      )
    })
  })

  describe('and a full world-undeployment event arrives', () => {
    it('should disable every place of the world', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processWorldUndeployment({
        timestamp: 1_700_000_000_000,
        metadata: { worldName: 'My-World.dcl.eth' }
      })

      expect(components.placesRepository.disableByWorldId).toHaveBeenCalledWith(
        components.pg,
        'my-world.dcl.eth',
        expect.any(Date)
      )
    })
  })
})
