import { timingSafeEqual } from 'crypto'
import type { IFetchComponent, IHttpServerComponent } from '@dcl/core-commons'
import type { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import type { ProfilePermission } from '../../types/entities'
import type { IProfilesComponent } from '../../logic/profiles'
import { ForbiddenError, UnauthorizedError } from '../../types/errors'
import { createSignedFetchMiddleware } from './signed-fetch'

type AuthedContext = IHttpServerComponent.DefaultContext & DecentralandSignatureContext

/**
 * Identity recorded for admin actions performed with the service admin bearer
 * token (which carries no wallet) — e.g. the moderator on a content-rating audit row.
 */
export const API_ADMIN_IDENTITY = 'api-admin'

/**
 * Authorization middleware, run after signed-fetch. Passes when the verified
 * wallet is an admin or holds at least one of the given permissions. With no
 * permissions listed, it requires admin.
 */
export function createRequirePermission(profiles: IProfilesComponent) {
  return (...permissions: ProfilePermission[]) =>
    async (
      ctx: AuthedContext,
      next: () => Promise<IHttpServerComponent.IResponse>
    ): Promise<IHttpServerComponent.IResponse> => {
      const user = ctx.verification?.auth?.toLowerCase()
      if (!user) {
        throw new UnauthorizedError('Authentication required')
      }
      const allowed = permissions.length ? await profiles.hasAnyPermission(user, permissions) : profiles.isAdmin(user)
      if (!allowed) {
        throw new ForbiddenError('Insufficient permissions')
      }
      return next()
    }
}

/**
 * Admin gate for moderation routes: passes on a valid service admin `Bearer`
 * token (any of the configured secrets, constant-time) OR on a signed-fetch
 * request from an admin wallet. On the bearer path a synthetic
 * `API_ADMIN_IDENTITY` verification is set so downstream handlers still have an
 * actor to record. Falsy tokens are ignored; a Bearer header with no configured
 * secret is rejected.
 */
export function createAdminAuth(
  fetcher: IFetchComponent,
  profiles: IProfilesComponent,
  adminTokens: Array<string | undefined>
) {
  const secrets = adminTokens.filter((token): token is string => !!token).map((token) => Buffer.from(token))
  const signed = createSignedFetchMiddleware(fetcher)()
  const requireAdmin = createRequirePermission(profiles)()

  return async (
    ctx: AuthedContext,
    next: () => Promise<IHttpServerComponent.IResponse>
  ): Promise<IHttpServerComponent.IResponse> => {
    const header = ctx.request.headers.get('authorization')
    if (header?.startsWith('Bearer ')) {
      const value = Buffer.from(header.slice('Bearer '.length))
      const ok = secrets.some((secret) => secret.length === value.length && timingSafeEqual(value, secret))
      if (!ok) {
        throw new UnauthorizedError('Invalid authorization header')
      }
      ctx.verification = { auth: API_ADMIN_IDENTITY, authMetadata: {} }
      return next()
    }
    // The router supplies the path-aware context at runtime; the signed middleware
    // only reads request/url/verification off it.
    return signed(ctx as Parameters<typeof signed>[0], () => requireAdmin(ctx, next))
  }
}
