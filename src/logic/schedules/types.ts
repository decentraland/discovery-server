import type { Schedule } from '../../types/entities'

export interface ISchedulesComponent {
  /** Currently-active schedules (active_until in the future). */
  getActiveSchedules(): Promise<Schedule[]>
  /** A single schedule; throws `ScheduleNotFoundError` if it does not exist. */
  getScheduleById(id: string): Promise<Schedule>
}
