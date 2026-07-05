import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import type { ProfilePermission, ProfileSettings } from '../../types/entities'
import { BadRequestError, UnauthorizedError } from '../../types/errors'

const VALID_PERMISSIONS: ProfilePermission[] = [
  'approve_own_event',
  'approve_any_event',
  'edit_any_event',
  'edit_any_schedule',
  'edit_any_profile',
  'test_any_notification'
] as ProfilePermission[]

/** Legacy `GET /api/profiles/settings` — all profiles that have permissions (admin/EditAnyProfile). */
export async function getProfileSettingsListHandler(
  context: Pick<HandlerContextWithPath<'profiles', '/api/profiles/settings'>, 'components'>
): Promise<HTTPResponse<ProfileSettings[]>> {
  const data = await context.components.profiles.listWithPermissions()
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `GET /api/profiles/me/settings` — the authenticated wallet's settings. */
export async function getMyProfileSettingsHandler(
  context: Pick<HandlerContextWithPath<'profiles', '/api/profiles/me/settings'>, 'components' | 'verification'>
): Promise<HTTPResponse<ProfileSettings>> {
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  const data = await context.components.profiles.getSettings(user)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `GET /api/profiles/:profile_id/settings` — another wallet's settings (admin/EditAnyProfile). */
export async function getProfileSettingsHandler(
  context: Pick<HandlerContextWithPath<'profiles'>, 'components' | 'params'>
): Promise<HTTPResponse<ProfileSettings>> {
  const profileId = (context.params as Record<string, string>).profile_id
  const data = await context.components.profiles.getSettings(profileId)
  return { status: 200, body: { ok: true, data } }
}

/** Legacy `PATCH /api/profiles/:profile_id/settings` — set a wallet's permissions (admin/EditAnyProfile). */
export async function updateProfileSettingsHandler(
  context: Pick<HandlerContextWithPath<'profiles'>, 'components' | 'params' | 'request'>
): Promise<HTTPResponse<ProfileSettings>> {
  const profileId = (context.params as Record<string, string>).profile_id

  let body: { permissions?: unknown }
  try {
    body = (await context.request.json()) as { permissions?: unknown }
  } catch {
    throw new BadRequestError('Invalid JSON body')
  }
  if (
    !Array.isArray(body.permissions) ||
    body.permissions.some((p) => !VALID_PERMISSIONS.includes(p as ProfilePermission))
  ) {
    throw new BadRequestError('permissions must be an array of valid permission values')
  }

  const data = await context.components.profiles.setPermissions(profileId, body.permissions as ProfilePermission[])
  return { status: 200, body: { ok: true, data } }
}
