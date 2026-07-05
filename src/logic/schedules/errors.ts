import { NotFoundError } from '../../types/errors'

export class ScheduleNotFoundError extends NotFoundError {
  constructor(id: string) {
    super(`Schedule not found: ${id}`)
  }
}
