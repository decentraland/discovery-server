import { createManifestComponent } from '../../src/logic/manifest'

describe('when rebuilding the Genesis City manifest', () => {
  let components: any

  beforeEach(() => {
    components = {
      pg: {},
      placesRepository: { listOccupiedPositions: jest.fn().mockResolvedValue(['0,0']) },
      manifestStorage: { uploadObject: jest.fn(), getUploadUrl: jest.fn(), publicUrl: jest.fn() },
      config: { getString: jest.fn().mockResolvedValue(undefined) },
      logs: { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the public bucket is not configured', () => {
    it('should be a no-op that publishes nothing', async () => {
      const manifest = await createManifestComponent(components)
      const result = await manifest.rebuild()

      expect(result.published).toBe(false)
      expect(components.manifestStorage.uploadObject).not.toHaveBeenCalled()
    })
  })

  describe('and the public bucket is configured', () => {
    beforeEach(() => {
      components.config.getString.mockResolvedValue('discovery-public')
    })

    it('should publish WorldManifest.json with occupied and empty parcels', async () => {
      const manifest = await createManifestComponent(components)
      const result = await manifest.rebuild()

      expect(result.published).toBe(true)
      expect(result.occupied).toBe(1)
      expect(result.empty).toBeGreaterThan(0)
      const [key, body, contentType] = components.manifestStorage.uploadObject.mock.calls[0]
      expect(key).toBe('WorldManifest.json')
      expect(contentType).toBe('application/json')
      const parsed = JSON.parse(body)
      expect(parsed.occupied).toEqual(['0,0'])
      expect(Array.isArray(parsed.roads)).toBe(true)
      expect(parsed.empty).not.toContain('0,0')
    })
  })
})
