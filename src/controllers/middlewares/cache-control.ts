import type { IHttpServerComponent } from '@dcl/core-commons'
import type { DecentralandSignatureContext } from '@dcl/crypto-middleware'

type AuthedContext = IHttpServerComponent.DefaultContext & DecentralandSignatureContext

/**
 * Marks authenticated (signed-fetch) responses as uncacheable. Signed reads carry
 * per-user fields (user_favorite / user_like / user_dislike), so a shared cache must
 * never serve one wallet's response to another. Anonymous responses have no per-user
 * data and are left cacheable. Runs after the per-route signed-fetch middleware has
 * populated `ctx.verification`.
 */
export async function cacheControlForAuthenticated(
  ctx: AuthedContext,
  next: () => Promise<IHttpServerComponent.IResponse>
): Promise<IHttpServerComponent.IResponse> {
  const response = await next()
  if (!ctx.verification?.auth) return response
  return {
    ...response,
    headers: { ...(response.headers as Record<string, string> | undefined), 'cache-control': 'private, no-store' }
  }
}
