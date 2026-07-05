import { NotFoundError } from '../../types/errors'

export class PlaceNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`Place not found: ${id}`)
  }
}
