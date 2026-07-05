/**
 * Shared error hierarchy for the discovery service.
 *
 * Domain components throw these typed exceptions; the central error-handler
 * middleware (`src/controllers/middlewares/error-handler.ts`) maps each one to
 * an HTTP status via its `statusCode`. No error codes, no Result/Either wrappers.
 *
 * The `@dcl/http-commons` middlewares (signed-fetch, bearer token) throw their
 * own `InvalidRequestError`/`NotFoundError`/`NotAuthorizedError`; the same
 * middleware recognizes those too, so both hierarchies are handled uniformly.
 */
export abstract class ServiceError extends Error {
  abstract readonly statusCode: number

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** 400 — malformed or semantically invalid request input. */
export class BadRequestError extends ServiceError {
  readonly statusCode = 400
}

/** 401 — request is not authenticated (missing/invalid signature or token). */
export class UnauthorizedError extends ServiceError {
  readonly statusCode = 401
}

/** 403 — authenticated but not permitted to perform the action. */
export class ForbiddenError extends ServiceError {
  readonly statusCode = 403
}

/** 404 — the referenced entity does not exist. */
export class NotFoundError extends ServiceError {
  readonly statusCode = 404
}

/** 409 — the request conflicts with the current state of the resource. */
export class ConflictError extends ServiceError {
  readonly statusCode = 409
}
