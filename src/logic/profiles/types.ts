import type { ProfilePermission, ProfileSettings } from '../../types/entities'

export interface IProfilesComponent {
  /** A wallet's settings; returns empty permissions if the wallet has no row. */
  getSettings(user: string): Promise<ProfileSettings>
  /** All wallets that have at least one permission. */
  listWithPermissions(): Promise<ProfileSettings[]>
  /** Replace a wallet's permission set. */
  setPermissions(user: string, permissions: ProfilePermission[]): Promise<ProfileSettings>
  /** Whether the wallet is in the ADMIN_ADDRESSES allow-list. */
  isAdmin(user: string): boolean
  /** Admin OR holds at least one of the given permissions. */
  hasAnyPermission(user: string, permissions: ProfilePermission[]): Promise<boolean>
}
