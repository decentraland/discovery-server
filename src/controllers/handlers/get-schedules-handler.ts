import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { Schedule } from '../../types/entities'

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
