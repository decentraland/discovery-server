import { NotFoundError } from '../../types/errors'

export class WorldNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`World not found: ${id}`)
  }
}
