import type { AppComponents } from '../../types'
import type { Schedule } from '../../types/entities'
import type { CreateScheduleInput, UpdateScheduleInput } from '../../adapters/schedules-repository'
import type { ISchedulesComponent } from './types'
import { ScheduleNotFoundError } from './errors'

/**
 * Curated schedule reads plus create/update. Writes are gated at the route by the
 * `EditAnySchedule` permission; the component owns the persistence orchestration.
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

  async function createSchedule(input: CreateScheduleInput): Promise<Schedule> {
    return schedulesRepository.create(pg, input)
  }

  async function updateSchedule(id: string, patch: UpdateScheduleInput): Promise<Schedule> {
    const updated = await schedulesRepository.update(pg, id, patch)
    if (!updated) {
      throw new ScheduleNotFoundError(id)
    }
    return updated
  }

  return { getActiveSchedules, getScheduleById, createSchedule, updateSchedule }
}
