import { timingSafeEqual } from 'crypto'
import type { IHttpServerComponent } from '@dcl/core-commons'
import { NotAuthorizedError } from '@dcl/http-commons'

/** Build constant-time-comparable secret buffers from a token list (falsy tokens ignored). */
export function toSecrets(tokens: Array<string | undefined>): Buffer[] {
  return tokens.filter((token): token is string => !!token).map((token) => Buffer.from(token))
}

/**
 * Constant-time check that an `Authorization` header carries a `Bearer <token>`
 * matching one of the secrets. Returns false for a missing/non-Bearer header.
 */
export function matchesBearer(header: string | null | undefined, secrets: Buffer[]): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const value = Buffer.from(header.slice('Bearer '.length))
  return secrets.some((secret) => secret.length === value.length && timingSafeEqual(value, secret))
}

/**
 * Accepts a `Bearer <token>` matching any of the provided secrets (constant-time).
 * Multiple secrets support the admin-token rotation window (new `API_ADMIN_TOKEN`
 * plus the legacy places/events tokens). Falsy secrets are ignored.
 */
export function createAnyBearerMiddleware(tokens: Array<string | undefined>) {
  const secrets = toSecrets(tokens)
  if (!secrets.length) {
    throw new Error('Bearer token middleware requires at least one secret')
  }

  return async function (
    ctx: IHttpServerComponent.DefaultContext,
    next: () => Promise<IHttpServerComponent.IResponse>
  ): Promise<IHttpServerComponent.IResponse> {
    const header = ctx.request.headers.get('authorization')
    if (!header) {
      throw new NotAuthorizedError('Authorization header is missing')
    }
    if (!matchesBearer(header, secrets)) {
      throw new NotAuthorizedError('Invalid authorization header')
    }
    return next()
  }
}
