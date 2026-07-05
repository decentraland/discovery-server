import type { Queryable } from '../pg'
import type { ProfilePermission, ProfileSettings } from '../../types/entities'

export interface IProfileSettingsRepository {
  findByUser(client: Queryable, user: string): Promise<ProfileSettings | null>
  /** All profiles that have at least one permission granted. */
  findAllWithPermissions(client: Queryable): Promise<ProfileSettings[]>
  upsertPermissions(client: Queryable, user: string, permissions: ProfilePermission[]): Promise<ProfileSettings>
}
