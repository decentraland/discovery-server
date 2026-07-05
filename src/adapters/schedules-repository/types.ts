import type { Queryable } from '../pg'
import type { Schedule } from '../../types/entities'

export type CreateScheduleInput = Omit<Schedule, 'id' | 'created_at' | 'updated_at'>
export type UpdateScheduleInput = Partial<CreateScheduleInput>

export interface ISchedulesRepository {
  /** Schedules whose `active_until` is still in the future (legacy list semantics). */
  findActive(client: Queryable): Promise<Schedule[]>
  findById(client: Queryable, id: string): Promise<Schedule | null>
  create(client: Queryable, input: CreateScheduleInput): Promise<Schedule>
  update(client: Queryable, id: string, input: UpdateScheduleInput): Promise<Schedule | null>
}
