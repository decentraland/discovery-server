import type { AppComponents } from '../../types'
import type { Schedule } from '../../types/entities'
import type { CreateScheduleInput, UpdateScheduleInput } from '../../adapters/schedules-repository'
import { sanitizeDescription, sanitizeImageUrl, sanitizePlainText } from '../content-sanitization'
import type { ISchedulesComponent } from './types'
import { ScheduleNotFoundError } from './errors'

// Sanitize a curated schedule at the read boundary: name/theme are plain-text labels, description
// is rich text, and image/background are safe public image URLs. Schedules are admin-authored,
// but this keeps the boundary consistent so a legacy/imported unsafe value can't reach a client.
function sanitizeSchedule(schedule: Schedule): Schedule {
  return {
    ...schedule,
    name: sanitizePlainText(schedule.name) ?? '',
    theme: sanitizePlainText(schedule.theme),
    description: sanitizeDescription(schedule.description),
    image: sanitizeImageUrl(schedule.image),
    background: (schedule.background ?? []).map((url) => sanitizeImageUrl(url)).filter((url): url is string => !!url)
  }
}

/**
 * Curated schedule reads plus create/update. Writes are gated at the route by the
 * `EditAnySchedule` permission; the component owns the persistence orchestration.
 */
export async function createSchedulesComponent(
  components: Pick<AppComponents, 'pg' | 'schedulesRepository' | 'logs'>
): Promise<ISchedulesComponent> {
  const { pg, schedulesRepository } = components

  async function getActiveSchedules(): Promise<Schedule[]> {
    return (await schedulesRepository.findActive(pg)).map(sanitizeSchedule)
  }

  async function getScheduleById(id: string): Promise<Schedule> {
    const schedule = await schedulesRepository.findById(pg, id)
    if (!schedule) {
      throw new ScheduleNotFoundError(id)
    }
    return sanitizeSchedule(schedule)
  }

  async function createSchedule(input: CreateScheduleInput): Promise<Schedule> {
    return sanitizeSchedule(await schedulesRepository.create(pg, input))
  }

  async function updateSchedule(id: string, patch: UpdateScheduleInput): Promise<Schedule> {
    const updated = await schedulesRepository.update(pg, id, patch)
    if (!updated) {
      throw new ScheduleNotFoundError(id)
    }
    return sanitizeSchedule(updated)
  }

  return { getActiveSchedules, getScheduleById, createSchedule, updateSchedule }
}
