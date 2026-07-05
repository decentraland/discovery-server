import SQL from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { Schedule } from '../../types/entities'
import type { CreateScheduleInput, ISchedulesRepository, UpdateScheduleInput } from './types'

/** Owns SQL for the `schedules` table. */
export function createSchedulesRepository(): ISchedulesRepository {
  async function findActive(client: Queryable): Promise<Schedule[]> {
    const result = await client.query<Schedule>(
      SQL`SELECT * FROM schedules WHERE active_until > now() ORDER BY active_since ASC`
    )
    return result.rows
  }

  async function findById(client: Queryable, id: string): Promise<Schedule | null> {
    const result = await client.query<Schedule>(SQL`SELECT * FROM schedules WHERE id = ${id}`)
    return result.rows[0] ?? null
  }

  async function create(client: Queryable, input: CreateScheduleInput): Promise<Schedule> {
    const result = await client.query<Schedule>(SQL`
      INSERT INTO schedules (name, description, image, theme, background, active, active_since, active_until)
      VALUES (${input.name}, ${input.description}, ${input.image}, ${input.theme}, ${input.background},
              ${input.active}, ${input.active_since}, ${input.active_until})
      RETURNING *`)
    return result.rows[0]
  }

  async function update(client: Queryable, id: string, input: UpdateScheduleInput): Promise<Schedule | null> {
    const query = SQL`UPDATE schedules SET updated_at = now()`
    if (input.name !== undefined) query.append(SQL`, name = ${input.name}`)
    if (input.description !== undefined) query.append(SQL`, description = ${input.description}`)
    if (input.image !== undefined) query.append(SQL`, image = ${input.image}`)
    if (input.theme !== undefined) query.append(SQL`, theme = ${input.theme}`)
    if (input.background !== undefined) query.append(SQL`, background = ${input.background}`)
    if (input.active !== undefined) query.append(SQL`, active = ${input.active}`)
    if (input.active_since !== undefined) query.append(SQL`, active_since = ${input.active_since}`)
    if (input.active_until !== undefined) query.append(SQL`, active_until = ${input.active_until}`)
    query.append(SQL` WHERE id = ${id} RETURNING *`)

    const result = await client.query<Schedule>(query)
    return result.rows[0] ?? null
  }

  return { findActive, findById, create, update }
}
