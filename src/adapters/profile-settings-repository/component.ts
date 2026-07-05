import SQL from 'sql-template-strings'
import type { Queryable } from '../pg'
import type { ProfilePermission, ProfileSettings } from '../../types/entities'
import type { IProfileSettingsRepository } from './types'

/** Owns SQL for the `profile_settings` table (permissions only; email columns dropped). */
export function createProfileSettingsRepository(): IProfileSettingsRepository {
  async function findByUser(client: Queryable, user: string): Promise<ProfileSettings | null> {
    const result = await client.query<ProfileSettings>(
      SQL`SELECT "user", permissions FROM profile_settings WHERE "user" = ${user.toLowerCase()}`
    )
    return result.rows[0] ?? null
  }

  async function findAllWithPermissions(client: Queryable): Promise<ProfileSettings[]> {
    const result = await client.query<ProfileSettings>(
      SQL`SELECT "user", permissions FROM profile_settings WHERE array_length(permissions, 1) > 0 ORDER BY "user"`
    )
    return result.rows
  }

  async function upsertPermissions(
    client: Queryable,
    user: string,
    permissions: ProfilePermission[]
  ): Promise<ProfileSettings> {
    const result = await client.query<ProfileSettings>(SQL`
      INSERT INTO profile_settings ("user", permissions)
      VALUES (${user.toLowerCase()}, ${permissions})
      ON CONFLICT ("user") DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now()
      RETURNING "user", permissions`)
    return result.rows[0]
  }

  return { findByUser, findAllWithPermissions, upsertPermissions }
}
