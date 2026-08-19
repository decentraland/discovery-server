import type { IFetchComponent } from '@dcl/core-commons'
import { rejectIfSigner, wellKnownComponents } from '@dcl/crypto-middleware'

/**
 * ADR-44 signed-fetch verification. On success the verified wallet is available
 * at `ctx.verification.auth`. Requests signed by scenes are rejected.
 *
 * - required (default): missing/invalid signature -> 401
 * - optional: missing signature passes through (`ctx.verification` undefined);
 *   an invalid signature still fails.
 */
export function createSignedFetchMiddleware(fetcher: IFetchComponent) {
  return ({ optional = false }: { optional?: boolean } = {}) =>
    wellKnownComponents({
      fetcher,
      optional,
      onError: (err: Error) => ({
        error: err.message,
        message: 'This endpoint requires a signed fetch request. See ADR-44.'
      }),
      metadataValidator: rejectIfSigner('decentraland-kernel-scene')
    })
}
