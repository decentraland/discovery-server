import { statusHandler } from '../../src/controllers/handlers/status-handler'

describe('when handling a status request', () => {
  let getString: jest.Mock
  let context: Parameters<typeof statusHandler>[0]

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the commit hash and version are configured', () => {
    beforeEach(() => {
      getString = jest.fn().mockResolvedValueOnce('abc123').mockResolvedValueOnce('1.2.3')
      context = { components: { config: { getString } } } as any
    })

    it('should respond with a 200 and the configured commit hash and version', async () => {
      const response = await statusHandler(context)

      expect(response).toEqual({
        status: 200,
        body: { ok: true, data: expect.objectContaining({ commitHash: 'abc123', version: '1.2.3' }) }
      })
    })
  })

  describe('and the commit hash and version are not configured', () => {
    beforeEach(() => {
      getString = jest.fn().mockResolvedValue(undefined)
      context = { components: { config: { getString } } } as any
    })

    it('should respond with a 200 and unknown placeholders', async () => {
      const response = await statusHandler(context)

      expect(response.body).toEqual({
        ok: true,
        data: expect.objectContaining({ commitHash: 'unknown', version: 'unknown' })
      })
    })
  })
})
