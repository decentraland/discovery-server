import { timingSafeEqual } from 'crypto'
import type { IHttpServerComponent } from '@dcl/core-commons'
import { NotAuthorizedError } from '@dcl/http-commons'

function matchesAny(value: string, secrets: Buffer[]): boolean {
  const valueBuffer = Buffer.from(value)
  return secrets.some((secret) => secret.length === valueBuffer.length && timingSafeEqual(valueBuffer, secret))
}

/**
 * Accepts a `Bearer <token>` matching any of the provided secrets (constant-time).
 * Multiple secrets support the admin-token rotation window (new `API_ADMIN_TOKEN`
 * plus the legacy places/events tokens). Falsy secrets are ignored.
 */
export function createAnyBearerMiddleware(tokens: Array<string | undefined>) {
  const secrets = tokens.filter((token): token is string => !!token).map((token) => Buffer.from(token))
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
    const [type, value] = header.split(' ')
    if (type !== 'Bearer' || !value || !matchesAny(value, secrets)) {
      throw new NotAuthorizedError('Invalid authorization header')
    }
    return next()
  }
}
