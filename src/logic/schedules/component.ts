import type { AppComponents } from '../../types'
import type { Schedule } from '../../types/entities'
import type { CreateScheduleInput, UpdateScheduleInput } from '../../adapters/schedules-repository'
import { sanitizeDescription, sanitizeImageUrl, sanitizePlainText } from '../content-sanitization'
import type { ISchedulesComponent } from './types'
import { ScheduleNotFoundError } from './errors'

// `background` is an array of CSS color / gradient-stop strings (e.g. `#f3f2f5`,
// `rgba(10,9,44,1)`, `linear-gradient(...)`), NOT image URLs — the client renders them directly
// as CSS. So each entry is treated as a plain-text token: strip any TMP markup and drop only
// empty/fully-markup entries, leaving valid color values untouched.
const sanitizeBackground = (background: string[] | null | undefined): string[] =>
  (background ?? []).map((value) => sanitizePlainText(value)).filter((value): value is string => !!value)

// Sanitize a curated schedule at the read boundary: name/theme are plain-text labels, description
// is rich text, image is a safe public URL, and background is a list of plain-text color tokens.
// Schedules are admin-authored, but this keeps the boundary consistent so a legacy/imported
// unsafe value can't reach a client.
function sanitizeSchedule(schedule: Schedule): Schedule {
  return {
    ...schedule,
    name: sanitizePlainText(schedule.name) ?? '',
    theme: sanitizePlainText(schedule.theme),
    description: sanitizeDescription(schedule.description),
    image: sanitizeImageUrl(schedule.image),
    background: sanitizeBackground(schedule.background)
  }
}

// Sanitize the content fields of a create/update payload so unsafe values are never persisted
// at rest either (only fields actually present are touched, so a partial update stays partial).
function sanitizeScheduleInput<T extends Partial<CreateScheduleInput>>(input: T): T {
  const out = { ...input }
  if ('name' in input) out.name = sanitizePlainText(input.name) ?? ''
  if ('theme' in input) out.theme = sanitizePlainText(input.theme ?? null)
  if ('description' in input) out.description = sanitizeDescription(input.description ?? null)
  if ('image' in input) out.image = sanitizeImageUrl(input.image ?? null)
  if ('background' in input) out.background = sanitizeBackground(input.background)
  return out
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
    return sanitizeSchedule(await schedulesRepository.create(pg, sanitizeScheduleInput(input)))
  }

  async function updateSchedule(id: string, patch: UpdateScheduleInput): Promise<Schedule> {
    const updated = await schedulesRepository.update(pg, id, sanitizeScheduleInput(patch))
    if (!updated) {
      throw new ScheduleNotFoundError(id)
    }
    return sanitizeSchedule(updated)
  }

  return { getActiveSchedules, getScheduleById, createSchedule, updateSchedule }
}
