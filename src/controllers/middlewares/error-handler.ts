import type { IHttpServerComponent } from '@dcl/core-commons'
import type { ComponentsWithLogger } from '@dcl/http-commons/dist/types'
import { InvalidRequestError, NotFoundError as CommonsNotFoundError, NotAuthorizedError } from '@dcl/http-commons'
import { ServiceError } from '../../types/errors'

/**
 * Central error mapping. Domain components throw `ServiceError` subclasses
 * (which carry a `statusCode`); the `@dcl/crypto-middleware` and bearer-token
 * middleware throw `@dcl/http-commons` errors. Both are mapped here to a
 * uniform `{ ok: false, error, message }` body. Anything else becomes a
 * logged 500.
 *
 * Registered as the outermost middleware so it wraps every route handler.
 */
export async function errorHandler(
  ctx: IHttpServerComponent.DefaultContext<ComponentsWithLogger>,
  next: () => Promise<IHttpServerComponent.IResponse>
): Promise<IHttpServerComponent.IResponse> {
  try {
    return await next()
  } catch (error: any) {
    if (error instanceof ServiceError) {
      return { status: error.statusCode, body: { ok: false, error: error.name, message: error.message } }
    }

    if (error instanceof InvalidRequestError) {
      return { status: 400, body: { ok: false, error: 'Bad Request', message: error.message } }
    }
    if (error instanceof CommonsNotFoundError) {
      return { status: 404, body: { ok: false, error: 'Not Found', message: error.message } }
    }
    if (error instanceof NotAuthorizedError) {
      return { status: 401, body: { ok: false, error: 'Not Authorized', message: error.message } }
    }

    const logger = ctx.components.logs.getLogger('error-handler')
    logger.error(`Unhandled error at ${ctx.url.toString()}: ${error?.message ?? String(error)}`)
    return { status: 500, body: { ok: false, error: 'Internal Server Error' } }
  }
}
