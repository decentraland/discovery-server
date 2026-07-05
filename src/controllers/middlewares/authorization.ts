import type { IHttpServerComponent } from '@dcl/core-commons'
import type { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import type { ProfilePermission } from '../../types/entities'
import type { IProfilesComponent } from '../../logic/profiles'
import { ForbiddenError, UnauthorizedError } from '../../types/errors'

type AuthedContext = IHttpServerComponent.DefaultContext & DecentralandSignatureContext

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
