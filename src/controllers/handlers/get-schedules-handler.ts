import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Schedule } from '../../types/entities'
import type { CreateScheduleInput, UpdateScheduleInput } from '../../adapters/schedules-repository'
import { BadRequestError } from '../../types/errors'

const SCHEDULE_KEYS = [
  'name',
  'description',
  'image',
  'theme',
  'background',
  'active',
  'active_since',
  'active_until'
] as const

/** Build a validated create/update payload from a request body, picking only known keys. */
function parseScheduleBody(body: any, requireCore: boolean): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new BadRequestError('Invalid JSON body')
  if (requireCore && (!body.name || !body.active_since || !body.active_until)) {
    throw new BadRequestError('name, active_since and active_until are required')
  }
  const patch: Record<string, unknown> = {}
  for (const key of SCHEDULE_KEYS) {
    if (key in body) patch[key] = body[key]
  }
  return patch
}

/** Legacy `GET /api/schedules` — currently-active schedules. */
export async function getSchedulesHandler(
  context: Pick<HandlerContextWithPath<'schedules', '/api/schedules'>, 'components'>
): Promise<HTTPResponse<Schedule[]>> {
  const { schedules } = context.components

  const data = await schedules.getActiveSchedules()

  return { status: 200, body: { ok: true, data } }
}

/** Legacy `GET /api/schedules/:schedule_id` — a single schedule. */
export async function getScheduleByIdHandler(
  context: Pick<HandlerContextWithPath<'schedules', '/api/schedules/:schedule_id'>, 'components' | 'params'>
): Promise<HTTPResponse<Schedule>> {
  const { schedules } = context.components

  const data = await schedules.getScheduleById(context.params.schedule_id)

  return { status: 200, body: { ok: true, data } }
}

/** Legacy `POST /api/schedules` — create a curated schedule (EditAnySchedule). */
export async function createScheduleHandler(
  context: Pick<HandlerContextWithPath<'schedules', '/api/schedules'>, 'components' | 'request'>
): Promise<HTTPResponse<Schedule>> {
  const { schedules } = context.components

  let body: any
  try {
    body = await context.request.json()
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }
  const parsed = parseScheduleBody(body, true)
  const input: CreateScheduleInput = {
    name: parsed.name as string,
    description: (parsed.description as string | null) ?? null,
    image: (parsed.image as string | null) ?? null,
    theme: (parsed.theme as string | null) ?? null,
    background: (parsed.background as string[]) ?? [],
    active: (parsed.active as boolean) ?? true,
    active_since: parsed.active_since as string,
    active_until: parsed.active_until as string
  }
  const data = await schedules.createSchedule(input)

  return { status: 201, body: { ok: true, data } }
}

/** Legacy `PATCH /api/schedules/:schedule_id` — update a schedule (EditAnySchedule). */
export async function updateScheduleHandler(
  context: Pick<HandlerContextWithPath<'schedules', '/api/schedules/:schedule_id'>, 'components' | 'params' | 'request'>
): Promise<HTTPResponse<Schedule>> {
  const { schedules } = context.components

  let body: any
  try {
    body = await context.request.json()
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }
  const patch = parseScheduleBody(body, false) as UpdateScheduleInput
  const data = await schedules.updateSchedule(context.params.schedule_id, patch)

  return { status: 200, body: { ok: true, data } }
}
