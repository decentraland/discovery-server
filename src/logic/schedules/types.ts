import type { Schedule } from '../../types/entities'
import type { CreateScheduleInput, UpdateScheduleInput } from '../../adapters/schedules-repository'

export interface ISchedulesComponent {
  /** Currently-active schedules (active_until in the future). */
  getActiveSchedules(): Promise<Schedule[]>
  /** A single schedule; throws `ScheduleNotFoundError` if it does not exist. */
  getScheduleById(id: string): Promise<Schedule>
  /** Create a curated schedule (route-gated by EditAnySchedule). */
  createSchedule(input: CreateScheduleInput): Promise<Schedule>
  /** Update a schedule; throws `ScheduleNotFoundError` if it does not exist. */
  updateSchedule(id: string, patch: UpdateScheduleInput): Promise<Schedule>
}
