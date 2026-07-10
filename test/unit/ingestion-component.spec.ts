import { createIngestionComponent } from '../../src/logic/ingestion'

describe('when ingesting world events', () => {
  let components: any

  beforeEach(() => {
    components = {
      pg: {},
      placesRepository: { upsertScene: jest.fn(), disableByWorldIdAndPositions: jest.fn().mockResolvedValue(0) },
      worldsRepository: { findByIdWithAggregates: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      subgraphsClient: { getNameOwner: jest.fn().mockResolvedValue(undefined) },
      logs: { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and a settings-changed event arrives for a new world', () => {
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

  describe('and a settings-changed event would downgrade the content rating', () => {
    beforeEach(() => {
      components.worldsRepository.findByIdWithAggregates.mockResolvedValue({
        id: 'my-world.dcl.eth',
        content_rating: 'A',
        owner: '0xowner'
      })
    })

    it('should not write the downgraded rating', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processWorldSettingsChanged({
        metadata: { worldName: 'my-world.dcl.eth', contentRating: 'E' }
      })

      const input = components.worldsRepository.upsert.mock.calls[0][1]
      expect(input.content_rating).toBeUndefined()
    })
  })

  describe('and a settings-changed event arrives for an existing world', () => {
    beforeEach(() => {
      components.worldsRepository.findByIdWithAggregates.mockResolvedValue({
        id: 'my-world.dcl.eth',
        content_rating: 'RP',
        owner: '0xowner'
      })
    })

    it('should re-resolve the on-chain owner so ownership transfers are reflected', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processWorldSettingsChanged({ metadata: { worldName: 'my-world.dcl.eth' } })

      expect(components.subgraphsClient.getNameOwner).toHaveBeenCalledWith('my-world.dcl.eth')
    })

    it('should leave the stored owner untouched when the lookup does not resolve', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processWorldSettingsChanged({ metadata: { worldName: 'my-world.dcl.eth' } })

      const input = components.worldsRepository.upsert.mock.calls[0][1]
      expect(input.owner).toBeUndefined()
    })

    describe('and the lookup resolves a different owner', () => {
      beforeEach(() => {
        components.subgraphsClient.getNameOwner.mockResolvedValue('0xnewowner')
      })

      it('should upsert the world with the newly resolved owner', async () => {
        const ingestion = await createIngestionComponent(components)
        await ingestion.processWorldSettingsChanged({ metadata: { worldName: 'my-world.dcl.eth' } })

        const input = components.worldsRepository.upsert.mock.calls[0][1]
        expect(input.owner).toBe('0xnewowner')
      })
    })
  })

  describe('and a scenes-undeployment event arrives', () => {
    it('should disable the world places at the undeployed base positions', async () => {
      const ingestion = await createIngestionComponent(components)
      await ingestion.processWorldScenesUndeployment({
        timestamp: 1_700_000_000_000,
        metadata: {
          worldName: 'My-World.dcl.eth',
          scenes: [{ entityId: 'e1', baseParcel: '0,0' }]
        }
      })

      expect(components.placesRepository.disableByWorldIdAndPositions).toHaveBeenCalledWith(
        components.pg,
        'my-world.dcl.eth',
        ['0,0'],
        expect.any(Date)
      )
    })
  })
})
