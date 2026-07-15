import { BadRequestError, ForbiddenError, NotFoundError } from '../../types/errors'

export class EventNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`Event not found: ${id}`)
  }
}

export class EventValidationError extends BadRequestError {}

export class EventUnauthorizedActionError extends ForbiddenError {
  constructor(message = 'Not allowed to modify this event') {
    super(message)
  }
}
