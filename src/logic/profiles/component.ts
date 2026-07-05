import type { AppComponents } from '../../types'
import type { ProfilePermission, ProfileSettings } from '../../types/entities'
import type { IProfilesComponent } from './types'

/**
 * Profile settings + authorization. Admin is the union of the `ADMIN_ADDRESSES`
 * allow-list and per-wallet granted permissions. (The foundation-address display
 * allow-list, fed from feature flags, is layered in with that adapter.)
 */
export async function createProfilesComponent(
  components: Pick<AppComponents, 'pg' | 'profileSettingsRepository' | 'config' | 'logs'>
): Promise<IProfilesComponent> {
  const { pg, profileSettingsRepository, config } = components

  const adminAddressesRaw = (await config.getString('ADMIN_ADDRESSES')) ?? ''
  const adminAddresses = new Set(
    adminAddressesRaw
      .split(',')
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean)
  )

  function isAdmin(user: string): boolean {
    return adminAddresses.has(user.toLowerCase())
  }

  async function getSettings(user: string): Promise<ProfileSettings> {
    const settings = await profileSettingsRepository.findByUser(pg, user)
    return settings ?? { user: user.toLowerCase(), permissions: [] }
  }

  async function listWithPermissions(): Promise<ProfileSettings[]> {
    return profileSettingsRepository.findAllWithPermissions(pg)
  }

  async function setPermissions(user: string, permissions: ProfilePermission[]): Promise<ProfileSettings> {
    return profileSettingsRepository.upsertPermissions(pg, user, permissions)
  }

  async function hasAnyPermission(user: string, permissions: ProfilePermission[]): Promise<boolean> {
    if (isAdmin(user)) return true
    if (!permissions.length) return false
    const settings = await profileSettingsRepository.findByUser(pg, user)
    if (!settings) return false
    return permissions.some((permission) => settings.permissions.includes(permission))
  }

  return { getSettings, listWithPermissions, setPermissions, isAdmin, hasAnyPermission }
}
