import type { AppComponents } from '../../types'
import type { Schedule } from '../../types/entities'
import type { ISchedulesComponent } from './types'
import { ScheduleNotFoundError } from './errors'

/**
 * Curated schedule reads. Write flows (create/update, gated by the
 * `EditAnySchedule` permission) are wired when the auth middleware lands.
 */
export async function createSchedulesComponent(
  components: Pick<AppComponents, 'pg' | 'schedulesRepository' | 'logs'>
): Promise<ISchedulesComponent> {
  const { pg, schedulesRepository } = components

  async function getActiveSchedules(): Promise<Schedule[]> {
    return schedulesRepository.findActive(pg)
  }

  async function getScheduleById(id: string): Promise<Schedule> {
    const schedule = await schedulesRepository.findById(pg, id)
    if (!schedule) {
      throw new ScheduleNotFoundError(id)
    }
    return schedule
  }

  return { getActiveSchedules, getScheduleById }
}
