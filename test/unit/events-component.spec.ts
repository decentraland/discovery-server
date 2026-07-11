import { createEventsComponent, EventValidationError } from '../../src/logic/events'
import { createRecurrenceComponent } from '../../src/logic/recurrence'
import { ProfilePermission } from '../../src/types/entities'

describe('when creating an event', () => {
  let components: any

  beforeEach(() => {
    components = {
      pg: {},
      eventsRepository: {
        create: jest.fn(),
        findById: jest.fn(),
        update: jest.fn(),
        list: jest.fn(),
        count: jest.fn()
      },
      attendeesRepository: { isAttending: jest.fn() },
      places: { getPlaces: jest.fn().mockResolvedValue({ data: [{ id: 'place-1' }], total: 1 }) },
      worlds: { getWorlds: jest.fn().mockResolvedValue({ data: [], total: 0 }) },
      profiles: { hasAnyPermission: jest.fn().mockResolvedValue(false) },
      recurrence: createRecurrenceComponent(),
      communitiesClient: {
        enabled: false,
        getManagedCommunities: jest.fn().mockResolvedValue([]),
        getCommunityMembers: jest.fn().mockResolvedValue([])
      },
      slackNotifier: { notify: jest.fn() },
      landClient: {
        getTile: jest.fn().mockResolvedValue(null),
        getEstateImage: jest.fn((id: string) => `https://land/estates/${id}.png`),
        getParcelImage: jest.fn((x: number, y: number) => `https://land/parcels/${x}/${y}.png`)
      },
      config: { getString: jest.fn().mockResolvedValue(undefined), getNumber: jest.fn().mockResolvedValue(undefined) },
      logs: { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the payload has no name', () => {
    it('should throw an EventValidationError', async () => {
      const events = await createEventsComponent(components)

      await expect(events.createEvent({ start_at: new Date().toISOString() } as any, '0xUSER')).rejects.toThrow(
        EventValidationError
      )
    })
  })

  describe('and the payload has an invalid finish_at', () => {
    it('should throw an EventValidationError', async () => {
      const events = await createEventsComponent(components)

      await expect(
        events.createEvent(
          { name: 'Bad', start_at: new Date().toISOString(), finish_at: 'not-a-date' } as any,
          '0xUSER'
        )
      ).rejects.toThrow(EventValidationError)
    })
  })

  describe('and the payload has a non-numeric duration', () => {
    it('should throw an EventValidationError', async () => {
      const events = await createEventsComponent(components)

      await expect(
        events.createEvent({ name: 'Bad', start_at: new Date().toISOString(), duration: 'abc' } as any, '0xUSER')
      ).rejects.toThrow(EventValidationError)
    })
  })

  describe('and the payload has an out-of-range recurrent_interval', () => {
    it('should throw an EventValidationError', async () => {
      const events = await createEventsComponent(components)

      await expect(
        events.createEvent(
          {
            name: 'Bad',
            start_at: new Date().toISOString(),
            duration: 3600000,
            recurrent: true,
            recurrent_frequency: 'DAILY',
            recurrent_interval: -2,
            recurrent_count: 3
          } as any,
          '0xUSER'
        )
      ).rejects.toThrow(EventValidationError)
    })
  })

  describe('and the creator has no approval permission', () => {
    beforeEach(() => {
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({ id: 'e1', ...row }))
    })

    it('should create the event as not approved', async () => {
      const events = await createEventsComponent(components)
      await events.createEvent(
        { name: 'Party', start_at: new Date(Date.now() + 3600_000).toISOString(), x: 0, y: 0 },
        '0xUSER'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({ approved: false, place_id: 'place-1', world: false })
      )
    })

    it('should post a Slack alert about the new submission', async () => {
      const events = await createEventsComponent(components)
      await events.createEvent(
        { name: 'Party', start_at: new Date(Date.now() + 3600_000).toISOString(), x: 0, y: 0 },
        '0xUSER'
      )

      expect(components.slackNotifier.notify).toHaveBeenCalledWith(
        expect.stringContaining('New event submitted'),
        undefined
      )
    })
  })

  describe('and the creator can approve their own events', () => {
    beforeEach(() => {
      components.profiles.hasAnyPermission.mockResolvedValue(true)
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({ id: 'e1', ...row }))
    })

    it('should create the event already approved and stamped by the creator', async () => {
      const events = await createEventsComponent(components)
      await events.createEvent(
        { name: 'Party', start_at: new Date(Date.now() + 3600_000).toISOString(), x: 0, y: 0 },
        '0xUSER'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({ approved: true, approved_by: '0xuser' })
      )
    })
  })

  describe('and deriving image/estate from Land on create', () => {
    beforeEach(() => {
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({ id: 'e1', ...row }))
    })

    it('should default a genesis event image to the parcel map when the client sends none', async () => {
      const events = await createEventsComponent(components)
      await events.createEvent(
        { name: 'P', start_at: new Date(Date.now() + 3600_000).toISOString(), x: 5, y: 6 },
        '0xU'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({ image: 'https://land/parcels/5/6.png' })
      )
    })

    it('should pull estate metadata and the estate image from the Land tile', async () => {
      components.landClient.getTile.mockResolvedValue({ estateId: '42', name: 'Big Estate' })
      const events = await createEventsComponent(components)
      await events.createEvent(
        { name: 'P', start_at: new Date(Date.now() + 3600_000).toISOString(), x: 5, y: 6 },
        '0xU'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({
          image: 'https://land/estates/42.png',
          estate_id: '42',
          estate_name: 'Big Estate',
          scene_name: 'Big Estate'
        })
      )
    })

    it('should keep a client-supplied image', async () => {
      const events = await createEventsComponent(components)
      await events.createEvent(
        { name: 'P', start_at: new Date(Date.now() + 3600_000).toISOString(), x: 5, y: 6, image: 'https://custom.png' },
        '0xU'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({ image: 'https://custom.png' })
      )
    })
  })

  describe('and the creator is a foundation address', () => {
    beforeEach(() => {
      components.config.getString.mockImplementation(async (key: string) =>
        key === 'FOUNDATION_ADDRESSES' ? '0xfoundation' : undefined
      )
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({ id: 'e1', ...row }))
    })

    it('should display the creator name as "Decentraland Foundation"', async () => {
      const events = await createEventsComponent(components)
      const created = await events.createEvent(
        { name: 'P', start_at: new Date(Date.now() + 3600_000).toISOString(), x: 0, y: 0, user_name: 'Someone' },
        '0xFOUNDATION'
      )

      expect(created.user_name).toBe('Decentraland Foundation')
    })
  })

  describe('and an admin updates an event via the admin bearer', () => {
    beforeEach(() => {
      components.eventsRepository.findById.mockResolvedValue({
        id: 'e1',
        user: '0xsomeoneelse',
        name: 'Party',
        approved: false,
        rejected: false
      })
      components.eventsRepository.update.mockImplementation(async (_c: unknown, _id: string, patch: any) => ({
        id: 'e1',
        name: 'Party',
        ...patch
      }))
    })

    it('should approve without a per-wallet permission and stamp the override actor', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent('e1', { approved: true }, '0xADMIN', { isAdmin: true, actor: 'jarvis-agent' })

      expect(components.eventsRepository.update).toHaveBeenCalledWith(
        components.pg,
        'e1',
        expect.objectContaining({ approved: true, approved_by: 'jarvis-agent' })
      )
    })

    it('should clear a prior rejection when approving', async () => {
      components.eventsRepository.findById.mockResolvedValue({
        id: 'e1',
        user: '0xsomeoneelse',
        name: 'Party',
        approved: false,
        rejected: true,
        rejection_reason: 'spam'
      })
      const events = await createEventsComponent(components)
      await events.updateEvent('e1', { approved: true }, '0xADMIN', { isAdmin: true })

      expect(components.eventsRepository.update).toHaveBeenCalledWith(
        components.pg,
        'e1',
        expect.objectContaining({ approved: true, rejected: false, rejected_by: null, rejection_reason: null })
      )
    })

    it('should reject a patch that both approves and rejects', async () => {
      const events = await createEventsComponent(components)

      await expect(
        events.updateEvent('e1', { approved: true, rejected: true }, '0xADMIN', { isAdmin: true })
      ).rejects.toThrow(EventValidationError)
    })
  })

  describe('and an owner holding only ApproveOwnEvent updates their own event', () => {
    beforeEach(() => {
      components.eventsRepository.findById.mockResolvedValue({
        id: 'e1',
        user: '0xowner',
        name: 'Party',
        approved: false,
        rejected: false
      })
      components.eventsRepository.update.mockImplementation(async (_c: unknown, _id: string, patch: any) => ({
        id: 'e1',
        name: 'Party',
        ...patch
      }))
      // Has ApproveOwnEvent, but NOT ApproveAnyEvent/EditAnyEvent.
      components.profiles.hasAnyPermission.mockImplementation(async (_user: string, perms: ProfilePermission[]) =>
        perms.includes(ProfilePermission.ApproveOwnEvent)
      )
    })

    it('should let them approve their own event', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent('e1', { approved: true, highlighted: true }, '0xOWNER', {})

      expect(components.eventsRepository.update).toHaveBeenCalledWith(
        components.pg,
        'e1',
        expect.objectContaining({ approved: true })
      )
    })

    it('should NOT let them highlight (feature) their own event', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent('e1', { approved: true, highlighted: true }, '0xOWNER', {})

      const patch = components.eventsRepository.update.mock.calls[0][2]
      expect(patch.highlighted).toBeUndefined()
    })
  })

  describe('and deleting an already-deleted event', () => {
    beforeEach(() => {
      components.eventsRepository.findById.mockResolvedValue({
        id: 'e1',
        user: '0xowner',
        name: 'Party',
        deleted_at: new Date()
      })
    })

    it('should be an idempotent no-op that does not overwrite the original deletion', async () => {
      const events = await createEventsComponent(components)
      await events.deleteEvent('e1', '0xowner', false)

      expect(components.eventsRepository.update).not.toHaveBeenCalled()
    })
  })

  describe('and the payload references a community', () => {
    let payload: any

    beforeEach(() => {
      payload = {
        name: 'Party',
        start_at: new Date(Date.now() + 3600_000).toISOString(),
        x: 0,
        y: 0,
        community_id: 'community-1'
      }
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({ id: 'e1', ...row }))
    })

    describe('and the communities client is disabled', () => {
      beforeEach(() => {
        components.communitiesClient.enabled = false
      })

      it('should store the community without validating ownership', async () => {
        const events = await createEventsComponent(components)
        await events.createEvent(payload, '0xUSER')

        expect(components.communitiesClient.getManagedCommunities).not.toHaveBeenCalled()
        expect(components.eventsRepository.create).toHaveBeenCalledWith(
          components.pg,
          expect.objectContaining({ community_id: 'community-1' })
        )
      })
    })

    describe('and the communities client is enabled', () => {
      beforeEach(() => {
        components.communitiesClient.enabled = true
      })

      describe('and the creator does not manage the community', () => {
        beforeEach(() => {
          components.communitiesClient.getManagedCommunities.mockResolvedValue([{ id: 'other-community' }])
        })

        it('should throw an EventValidationError', async () => {
          const events = await createEventsComponent(components)

          await expect(events.createEvent(payload, '0xUSER')).rejects.toThrow(EventValidationError)
        })
      })

      describe('and the creator manages the community', () => {
        beforeEach(() => {
          components.communitiesClient.getManagedCommunities.mockResolvedValue([{ id: 'community-1' }])
        })

        it('should create the event attached to the community', async () => {
          const events = await createEventsComponent(components)
          await events.createEvent(payload, '0xUSER')

          expect(components.eventsRepository.create).toHaveBeenCalledWith(
            components.pg,
            expect.objectContaining({ community_id: 'community-1' })
          )
        })
      })
    })
  })
})
