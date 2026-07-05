import { createReportsComponent } from '../../src/logic/reports'
import type { IStorageComponent } from '../../src/adapters/storage'

describe('when creating a report upload url', () => {
  let reportsStorage: jest.Mocked<IStorageComponent>
  let logs: any

  beforeEach(() => {
    reportsStorage = {
      getUploadUrl: jest.fn().mockResolvedValue('https://bucket/presigned'),
      uploadObject: jest.fn(),
      publicUrl: jest.fn()
    }
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and a user requests a report url', () => {
    it('should request a presigned json upload url under a per-user report key', async () => {
      const reports = await createReportsComponent({ reportsStorage, logs })
      await reports.createReportUploadUrl('0xUSER')

      expect(reportsStorage.getUploadUrl).toHaveBeenCalledWith(expect.stringMatching(/^reports\/0xuser\/.+\.json$/), {
        contentType: 'application/json'
      })
    })

    it('should return the presigned url', async () => {
      const reports = await createReportsComponent({ reportsStorage, logs })
      const result = await reports.createReportUploadUrl('0xUSER')

      expect(result.url).toBe('https://bucket/presigned')
    })
  })
})
