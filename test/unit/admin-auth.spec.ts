import { createAdminAuth, API_ADMIN_IDENTITY } from '../../src/controllers/middlewares/authorization'

describe('when authorizing a moderation request with the admin bearer', () => {
  let fetcher: any
  let profiles: any
  let next: jest.Mock

  const contextWithAuth = (header: string | null) =>
    ({ request: { headers: { get: (name: string) => (name === 'authorization' ? header : null) } } }) as any

  beforeEach(() => {
    fetcher = { fetch: jest.fn() }
    profiles = { isAdmin: jest.fn(), hasAnyPermission: jest.fn() }
    next = jest.fn().mockResolvedValue({ status: 200 })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the bearer token matches a configured secret', () => {
    it('should call next without touching signed-fetch verification', async () => {
      const middleware = createAdminAuth(fetcher, profiles, ['secret-token'])
      await middleware(contextWithAuth('Bearer secret-token'), next)

      expect(next).toHaveBeenCalledTimes(1)
    })

    it('should stamp the synthetic admin identity so handlers have an actor', async () => {
      const middleware = createAdminAuth(fetcher, profiles, ['secret-token'])
      const ctx = contextWithAuth('Bearer secret-token')
      await middleware(ctx, next)

      expect(ctx.verification).toEqual({ auth: API_ADMIN_IDENTITY, authMetadata: {} })
    })

    it('should accept a legacy rotation-alias token', async () => {
      const middleware = createAdminAuth(fetcher, profiles, [undefined, 'legacy-places-token'])
      await middleware(contextWithAuth('Bearer legacy-places-token'), next)

      expect(next).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the bearer token does not match any configured secret', () => {
    it('should reject the request', async () => {
      const middleware = createAdminAuth(fetcher, profiles, ['secret-token'])

      await expect(middleware(contextWithAuth('Bearer wrong'), next)).rejects.toThrow()
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('and a bearer is presented but no admin token is configured', () => {
    it('should reject rather than fall through to signed-fetch', async () => {
      const middleware = createAdminAuth(fetcher, profiles, [undefined, undefined])

      await expect(middleware(contextWithAuth('Bearer anything'), next)).rejects.toThrow()
      expect(next).not.toHaveBeenCalled()
    })
  })
})
