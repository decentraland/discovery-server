import { errorHandler } from '../../src/controllers/middlewares/error-handler'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../src/types/errors'

describe('when a downstream handler throws', () => {
  let context: any
  let loggerError: jest.Mock

  beforeEach(() => {
    loggerError = jest.fn()
    context = {
      url: new URL('http://localhost/api/places'),
      components: {
        logs: { getLogger: () => ({ error: loggerError, info: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
      }
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the error is a NotFoundError', () => {
    let next: jest.Mock

    beforeEach(() => {
      next = jest.fn().mockRejectedValue(new NotFoundError('place not found'))
    })

    it('should respond with a 404 and the error name and message', async () => {
      const response = await errorHandler(context, next)

      expect(response).toEqual({ status: 404, body: { ok: false, error: 'NotFoundError', message: 'place not found' } })
    })
  })

  describe('and the error is a BadRequestError', () => {
    let next: jest.Mock

    beforeEach(() => {
      next = jest.fn().mockRejectedValue(new BadRequestError('invalid position'))
    })

    it('should respond with a 400 and the error name and message', async () => {
      const response = await errorHandler(context, next)

      expect(response).toEqual({
        status: 400,
        body: { ok: false, error: 'BadRequestError', message: 'invalid position' }
      })
    })
  })

  describe('and the error is a ForbiddenError', () => {
    let next: jest.Mock

    beforeEach(() => {
      next = jest.fn().mockRejectedValue(new ForbiddenError('not an admin'))
    })

    it('should respond with a 403 and the error name and message', async () => {
      const response = await errorHandler(context, next)

      expect(response).toEqual({ status: 403, body: { ok: false, error: 'ForbiddenError', message: 'not an admin' } })
    })
  })

  describe('and the error is a ConflictError', () => {
    let next: jest.Mock

    beforeEach(() => {
      next = jest.fn().mockRejectedValue(new ConflictError('already favorited'))
    })

    it('should respond with a 409 and the error name and message', async () => {
      const response = await errorHandler(context, next)

      expect(response).toEqual({
        status: 409,
        body: { ok: false, error: 'ConflictError', message: 'already favorited' }
      })
    })
  })

  describe('and the error is an unexpected error', () => {
    let next: jest.Mock

    beforeEach(() => {
      next = jest.fn().mockRejectedValue(new Error('boom'))
    })

    it('should respond with a 500 and a generic error body', async () => {
      const response = await errorHandler(context, next)

      expect(response).toEqual({ status: 500, body: { ok: false, error: 'Internal Server Error' } })
    })
  })

  describe('and the handler resolves normally', () => {
    let next: jest.Mock

    beforeEach(() => {
      next = jest.fn().mockResolvedValue({ status: 200, body: { ok: true } })
    })

    it('should pass the response through unchanged', async () => {
      const response = await errorHandler(context, next)

      expect(response).toEqual({ status: 200, body: { ok: true } })
    })
  })
})
