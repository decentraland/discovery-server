import SQL from 'sql-template-strings'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { ProfilePermission } from '../../src/types/entities'
import { test } from '../components'

test('when accessing profile settings', function ({ components }) {
  describe('and requesting own settings while authenticated', () => {
    let identity: Awaited<ReturnType<typeof getIdentity>>

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM profile_settings`)
      identity = await getIdentity()
    })

    it('should return empty permissions for a wallet with no row', async () => {
      const path = '/api/profiles/me/settings'
      const headers = getSignedAuthHeaders('GET', path, {}, identity)
      const response = await components.localFetch.fetch(path, { headers })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(expect.objectContaining({ permissions: [] }))
    })
  })

  describe('and listing all profiles with permissions', () => {
    let identity: Awaited<ReturnType<typeof getIdentity>>
    let address: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM profile_settings`)
      identity = await getIdentity()
      address = identity.realAccount.address.toLowerCase()
    })

    it('should forbid a wallet without the edit_any_profile permission', async () => {
      const path = '/api/profiles/settings'
      const headers = getSignedAuthHeaders('GET', path, {}, identity)
      const response = await components.localFetch.fetch(path, { headers })

      expect(response.status).toBe(403)
    })

    it('should allow a wallet granted the edit_any_profile permission', async () => {
      await components.profileSettingsRepository.upsertPermissions(components.pg, address, [
        ProfilePermission.EditAnyProfile
      ])

      const path = '/api/profiles/settings'
      const headers = getSignedAuthHeaders('GET', path, {}, identity)
      const response = await components.localFetch.fetch(path, { headers })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ user: address, permissions: ['edit_any_profile'] })])
      )
    })
  })
})
