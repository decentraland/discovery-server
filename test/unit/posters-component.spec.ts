import { createPostersComponent } from '../../src/logic/posters'
import { BadRequestError } from '../../src/types/errors'
import type { IStorageComponent } from '../../src/adapters/storage'

describe('when uploading a poster', () => {
  let postersStorage: jest.Mocked<IStorageComponent>
  let logs: any

  beforeEach(() => {
    postersStorage = {
      getUploadUrl: jest.fn(),
      uploadObject: jest.fn().mockResolvedValue(undefined),
      publicUrl: jest.fn().mockReturnValue('https://cdn/poster.png')
    }
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the file is a valid png', () => {
    it('should upload the bytes and return the public url', async () => {
      const posters = await createPostersComponent({ postersStorage, logs })
      const url = await posters.uploadHorizontal({ value: Buffer.from('img'), mimeType: 'image/png' })

      expect(postersStorage.uploadObject).toHaveBeenCalledWith(
        expect.stringMatching(/^posters\/.+\.png$/),
        expect.any(Buffer),
        'image/png'
      )
      expect(url).toBe('https://cdn/poster.png')
    })
  })

  describe('and the file exceeds the size limit', () => {
    it('should throw a BadRequestError', async () => {
      const posters = await createPostersComponent({ postersStorage, logs })
      const big = { value: Buffer.alloc(500 * 1024 + 1), mimeType: 'image/png' }

      await expect(posters.uploadHorizontal(big)).rejects.toThrow(BadRequestError)
    })
  })

  describe('and a gif is uploaded to the vertical poster', () => {
    it('should reject the unsupported type', async () => {
      const posters = await createPostersComponent({ postersStorage, logs })

      await expect(posters.uploadVertical({ value: Buffer.from('g'), mimeType: 'image/gif' })).rejects.toThrow(
        BadRequestError
      )
    })
  })

  describe('and a gif is uploaded to the horizontal poster', () => {
    it('should accept it', async () => {
      const posters = await createPostersComponent({ postersStorage, logs })

      await expect(posters.uploadHorizontal({ value: Buffer.from('g'), mimeType: 'image/gif' })).resolves.toBeDefined()
    })
  })

  describe('and no file is provided', () => {
    it('should throw a BadRequestError', async () => {
      const posters = await createPostersComponent({ postersStorage, logs })

      await expect(posters.uploadHorizontal(undefined)).rejects.toThrow(BadRequestError)
    })
  })
})
