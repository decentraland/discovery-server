import { createProfilesComponent } from '../../src/logic/profiles'
import { ProfilePermission } from '../../src/types/entities'
import type { IProfileSettingsRepository } from '../../src/adapters/profile-settings-repository'

describe('when checking profile authorization', () => {
  let profileSettingsRepository: jest.Mocked<IProfileSettingsRepository>
  let config: any
  let pg: any
  let logs: any

  beforeEach(() => {
    profileSettingsRepository = {
      findByUser: jest.fn(),
      findAllWithPermissions: jest.fn(),
      upsertPermissions: jest.fn()
    }
    config = { getString: jest.fn().mockResolvedValue('0xADMIN') }
    pg = {}
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the wallet is in the admin allow-list', () => {
    it('should be treated as admin regardless of case', async () => {
      const profiles = await createProfilesComponent({ pg, profileSettingsRepository, config, logs })

      expect(profiles.isAdmin('0xadmin')).toBe(true)
    })

    it('should have any permission without a database lookup', async () => {
      const profiles = await createProfilesComponent({ pg, profileSettingsRepository, config, logs })
      const allowed = await profiles.hasAnyPermission('0xADMIN', [ProfilePermission.EditAnyProfile])

      expect(allowed).toBe(true)
      expect(profileSettingsRepository.findByUser).not.toHaveBeenCalled()
    })
  })

  describe('and the wallet holds a matching granted permission', () => {
    beforeEach(() => {
      profileSettingsRepository.findByUser.mockResolvedValueOnce({
        user: '0xuser',
        permissions: [ProfilePermission.EditAnySchedule]
      })
    })

    it('should be allowed for that permission', async () => {
      const profiles = await createProfilesComponent({ pg, profileSettingsRepository, config, logs })
      const allowed = await profiles.hasAnyPermission('0xuser', [ProfilePermission.EditAnySchedule])

      expect(allowed).toBe(true)
    })
  })

  describe('and the wallet is neither admin nor holds the permission', () => {
    beforeEach(() => {
      profileSettingsRepository.findByUser.mockResolvedValueOnce({ user: '0xuser', permissions: [] })
    })

    it('should be denied', async () => {
      const profiles = await createProfilesComponent({ pg, profileSettingsRepository, config, logs })
      const allowed = await profiles.hasAnyPermission('0xuser', [ProfilePermission.EditAnyProfile])

      expect(allowed).toBe(false)
    })
  })
})
