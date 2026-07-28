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
        getCommunity: jest.fn().mockResolvedValue(null),
        getCommunityMembers: jest.fn().mockResolvedValue([])
      },
      notifications: {
        notifyEventApproved: jest.fn().mockResolvedValue(undefined),
        notifyEventRejected: jest.fn().mockResolvedValue(undefined),
        notifyEventDeleted: jest.fn().mockResolvedValue(undefined),
        notifyCommunityEventPublished: jest.fn().mockResolvedValue(undefined)
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
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        ...row
      }))
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
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        ...row
      }))
    })

    it('should still create the event unapproved (every event requires moderator approval)', async () => {
      const events = await createEventsComponent(components)
      await events.createEvent(
        { name: 'Party', start_at: new Date(Date.now() + 3600_000).toISOString(), x: 0, y: 0 },
        '0xUSER'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({ approved: false, approved_by: null })
      )
    })
  })

  describe('and deriving image/estate from Land on create', () => {
    beforeEach(() => {
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        ...row
      }))
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
        {
          name: 'P',
          start_at: new Date(Date.now() + 3600_000).toISOString(),
          x: 5,
          y: 6,
          image: 'https://cdn.example.org/custom.png'
        },
        '0xU'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({ image: 'https://cdn.example.org/custom.png' })
      )
    })

    it('should reject an unsafe client image and fall back to the parcel map', async () => {
      const events = await createEventsComponent(components)
      await events.createEvent(
        {
          name: 'P',
          start_at: new Date(Date.now() + 3600_000).toISOString(),
          x: 5,
          y: 6,
          image: 'https://a"><script>alert(1)</script><meta name="x'
        },
        '0xU'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({ image: 'https://land/parcels/5/6.png' })
      )
    })

    it('should reject an unsafe client image_vertical', async () => {
      const events = await createEventsComponent(components)
      await events.createEvent(
        {
          name: 'P',
          start_at: new Date(Date.now() + 3600_000).toISOString(),
          x: 5,
          y: 6,
          image_vertical: 'javascript:alert(1)'
        },
        '0xU'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({ image_vertical: null })
      )
    })
  })

  describe('and the creator is a foundation address', () => {
    beforeEach(() => {
      components.config.getString.mockImplementation(async (key: string) =>
        key === 'FOUNDATION_ADDRESSES' ? '0xfoundation' : undefined
      )
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        ...row
      }))
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
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xsomeoneelse',
        name: 'Party',
        approved: false,
        rejected: false
      })
      components.eventsRepository.update.mockImplementation(async (_c: unknown, _id: string, patch: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Party',
        ...patch
      }))
    })

    it('should approve without a per-wallet permission and stamp the override actor', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent('11111111-1111-4111-8111-111111111111', { approved: true }, '0xADMIN', {
        isAdmin: true,
        actor: 'jarvis-agent'
      })

      expect(components.eventsRepository.update).toHaveBeenCalledWith(
        components.pg,
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({ approved: true, approved_by: 'jarvis-agent' })
      )
    })

    it('should clear a prior rejection when approving', async () => {
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xsomeoneelse',
        name: 'Party',
        approved: false,
        rejected: true,
        rejection_reason: 'spam'
      })
      const events = await createEventsComponent(components)
      await events.updateEvent('11111111-1111-4111-8111-111111111111', { approved: true }, '0xADMIN', { isAdmin: true })

      expect(components.eventsRepository.update).toHaveBeenCalledWith(
        components.pg,
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({ approved: true, rejected: false, rejected_by: null, rejection_reason: null })
      )
    })

    it('should reject a patch that both approves and rejects', async () => {
      const events = await createEventsComponent(components)

      await expect(
        events.updateEvent('11111111-1111-4111-8111-111111111111', { approved: true, rejected: true }, '0xADMIN', {
          isAdmin: true
        })
      ).rejects.toThrow(EventValidationError)
    })
  })

  describe('and an owner holding only ApproveOwnEvent updates their own event', () => {
    beforeEach(() => {
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        approved: false,
        rejected: false
      })
      components.eventsRepository.update.mockImplementation(async (_c: unknown, _id: string, patch: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
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
      await events.updateEvent(
        '11111111-1111-4111-8111-111111111111',
        { approved: true, highlighted: true },
        '0xOWNER',
        {}
      )

      expect(components.eventsRepository.update).toHaveBeenCalledWith(
        components.pg,
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({ approved: true })
      )
    })

    it('should NOT let them highlight (feature) their own event', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent(
        '11111111-1111-4111-8111-111111111111',
        { approved: true, highlighted: true },
        '0xOWNER',
        {}
      )

      const patch = components.eventsRepository.update.mock.calls[0][2]
      expect(patch.highlighted).toBeUndefined()
    })
  })

  describe('and deleting an already-deleted event', () => {
    beforeEach(() => {
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        deleted_at: new Date()
      })
    })

    it('should be an idempotent no-op that does not overwrite the original deletion', async () => {
      const events = await createEventsComponent(components)
      await events.deleteEvent('11111111-1111-4111-8111-111111111111', '0xowner', false)

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
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        ...row
      }))
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

  describe('and a moderator approves a pending event', () => {
    beforeEach(() => {
      components.profiles.hasAnyPermission.mockResolvedValue(true)
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        description: 'desc',
        image: 'https://img',
        approved: false,
        rejected: false,
        community_id: null
      })
      components.eventsRepository.update.mockImplementation(async (_c: unknown, _id: string, patch: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        community_id: null,
        ...patch
      }))
    })

    it('should notify the creator that the event was approved', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent('11111111-1111-4111-8111-111111111111', { approved: true }, '0xMOD', {})

      expect(components.notifications.notifyEventApproved).toHaveBeenCalledTimes(1)
    })

    it('should not fan a community notification out when the event has no community', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent('11111111-1111-4111-8111-111111111111', { approved: true }, '0xMOD', {})

      expect(components.notifications.notifyCommunityEventPublished).not.toHaveBeenCalled()
    })

    describe('and the event is attached to a community', () => {
      beforeEach(() => {
        components.eventsRepository.findById.mockResolvedValue({
          id: '11111111-1111-4111-8111-111111111111',
          user: '0xowner',
          name: 'Party',
          approved: false,
          rejected: false,
          community_id: 'community-1'
        })
        components.eventsRepository.update.mockImplementation(async (_c: unknown, _id: string, patch: any) => ({
          id: '11111111-1111-4111-8111-111111111111',
          user: '0xowner',
          name: 'Party',
          community_id: 'community-1',
          ...patch
        }))
      })

      it('should fan a community-event notification out to the members', async () => {
        const events = await createEventsComponent(components)
        await events.updateEvent('11111111-1111-4111-8111-111111111111', { approved: true }, '0xMOD', {})

        expect(components.notifications.notifyCommunityEventPublished).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('and an already-approved event moves to a different community', () => {
    beforeEach(() => {
      components.communitiesClient.enabled = true
      components.communitiesClient.getManagedCommunities.mockResolvedValue([{ id: 'community-1' }])
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        approved: true,
        rejected: false,
        community_id: 'old-community'
      })
      components.eventsRepository.update.mockImplementation(async (_c: unknown, _id: string, patch: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        approved: true,
        community_id: 'old-community',
        ...patch
      }))
    })

    it('should fan a community-event notification out for the new community without a re-approval', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent('11111111-1111-4111-8111-111111111111', { community_id: 'community-1' }, '0xowner', {})

      expect(components.notifications.notifyCommunityEventPublished).toHaveBeenCalledTimes(1)
    })

    it('should not notify a fresh approval since the event was already approved', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent('11111111-1111-4111-8111-111111111111', { community_id: 'community-1' }, '0xowner', {})

      expect(components.notifications.notifyEventApproved).not.toHaveBeenCalled()
    })
  })

  describe('and a moderator rejects a pending event', () => {
    beforeEach(() => {
      components.profiles.hasAnyPermission.mockResolvedValue(true)
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        approved: false,
        rejected: false,
        community_id: null
      })
      components.eventsRepository.update.mockImplementation(async (_c: unknown, _id: string, patch: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        community_id: null,
        ...patch
      }))
    })

    it('should notify the creator that the event was rejected with the reason', async () => {
      const events = await createEventsComponent(components)
      await events.updateEvent(
        '11111111-1111-4111-8111-111111111111',
        { rejected: true, rejection_reason: 'spam' },
        '0xMOD',
        {}
      )

      expect(components.notifications.notifyEventRejected).toHaveBeenCalledWith(
        expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' }),
        'spam'
      )
    })
  })

  describe("and a moderator deletes another user's event", () => {
    beforeEach(() => {
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        deleted_at: null
      })
      components.eventsRepository.update.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    })

    it('should record the reason and notify the creator', async () => {
      const events = await createEventsComponent(components)
      await events.deleteEvent('11111111-1111-4111-8111-111111111111', '0xADMIN', true, undefined, 'inappropriate')

      expect(components.eventsRepository.update).toHaveBeenCalledWith(
        components.pg,
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({ deleted_reason: 'inappropriate' })
      )
    })

    it('should notify the creator of the deletion with the reason', async () => {
      const events = await createEventsComponent(components)
      await events.deleteEvent('11111111-1111-4111-8111-111111111111', '0xADMIN', true, undefined, 'inappropriate')

      expect(components.notifications.notifyEventDeleted).toHaveBeenCalledWith(
        expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' }),
        'inappropriate'
      )
    })
  })

  describe('and an owner deletes their own event', () => {
    beforeEach(() => {
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        deleted_at: null
      })
      components.eventsRepository.update.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    })

    it('should not notify the creator', async () => {
      const events = await createEventsComponent(components)
      await events.deleteEvent('11111111-1111-4111-8111-111111111111', '0xowner', false)

      expect(components.notifications.notifyEventDeleted).not.toHaveBeenCalled()
    })
  })

  describe('and reading an event whose stored description contains client-rendered markup', () => {
    let result: any

    beforeEach(async () => {
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        description:
          'Join <link="decentraland://?position=0,0">here</link> and <link="https://decentraland.org">site</link>',
        approved: true,
        rejected: false,
        deleted_at: null
      })
      const events = await createEventsComponent(components)
      result = await events.getEvent('11111111-1111-4111-8111-111111111111', '0xowner')
    })

    it('should strip the unsafe link and keep the safe one in the response', () => {
      expect(result.description).toBe('Join here and <link="https://decentraland.org">site</link>')
    })
  })

  describe('and reading an event whose stored image points at an internal host', () => {
    let result: any

    beforeEach(async () => {
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        image: 'https://169.254.169.254/thumb.png',
        approved: true,
        rejected: false,
        deleted_at: null
      })
      const events = await createEventsComponent(components)
      result = await events.getEvent('11111111-1111-4111-8111-111111111111', '0xowner')
    })

    it('should reject the unsafe image on read', () => {
      expect(result.image).toBeNull()
    })
  })

  describe('and editing the content of an already-approved event', () => {
    beforeEach(() => {
      components.eventsRepository.findById.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        description: 'Original description',
        image: 'https://img.png',
        approved: true,
        rejected: false,
        highlighted: true,
        x: 0,
        y: 0,
        server: null,
        world_id: null,
        community_id: null,
        categories: []
      })
      components.eventsRepository.update.mockImplementation(async (_c: unknown, _id: string, patch: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        user: '0xowner',
        name: 'Party',
        approved: true,
        community_id: null,
        ...patch
      }))
    })

    describe('and the editor is the owner without approval permission', () => {
      beforeEach(async () => {
        const events = await createEventsComponent(components)
        await events.updateEvent(
          '11111111-1111-4111-8111-111111111111',
          { description: 'Sneaky <link="file:///etc/passwd">x</link> edit' },
          '0xowner',
          {}
        )
      })

      it('should re-queue the event for moderation by clearing approval and the feature flag', () => {
        expect(components.eventsRepository.update).toHaveBeenCalledWith(
          components.pg,
          '11111111-1111-4111-8111-111111111111',
          expect.objectContaining({ approved: false, approved_by: null, highlighted: false })
        )
      })
    })

    describe('and the owner re-submits the identical description', () => {
      beforeEach(async () => {
        const events = await createEventsComponent(components)
        await events.updateEvent(
          '11111111-1111-4111-8111-111111111111',
          { description: 'Original description' },
          '0xowner',
          {}
        )
      })

      it('should keep the event approved since no content actually changed', () => {
        const patch = components.eventsRepository.update.mock.calls[0][2]
        expect(patch.approved).toBeUndefined()
      })
    })

    describe('and the owner edits only a scheduling/control field', () => {
      beforeEach(async () => {
        const events = await createEventsComponent(components)
        await events.updateEvent('11111111-1111-4111-8111-111111111111', { all_day: true }, '0xowner', {})
      })

      it('should keep the event approved', () => {
        const patch = components.eventsRepository.update.mock.calls[0][2]
        expect(patch.approved).toBeUndefined()
      })
    })

    describe('and the editor is a moderator who can approve', () => {
      beforeEach(async () => {
        components.profiles.hasAnyPermission.mockResolvedValue(true)
        const events = await createEventsComponent(components)
        await events.updateEvent(
          '11111111-1111-4111-8111-111111111111',
          { description: 'Moderator-reviewed <link="file:///etc/passwd">x</link> edit' },
          '0xMOD',
          {}
        )
      })

      it('should keep the event approved since the moderator edit is itself a review', () => {
        const patch = components.eventsRepository.update.mock.calls[0][2]
        expect(patch.approved).toBeUndefined()
      })
    })

    describe('and the owner changes the public url', () => {
      beforeEach(async () => {
        const events = await createEventsComponent(components)
        await events.updateEvent(
          '11111111-1111-4111-8111-111111111111',
          { url: 'https://malicious.example/redirect' },
          '0xowner',
          {}
        )
      })

      it('should re-queue the event for moderation by clearing approval', () => {
        expect(components.eventsRepository.update).toHaveBeenCalledWith(
          components.pg,
          '11111111-1111-4111-8111-111111111111',
          expect.objectContaining({ approved: false, approved_by: null, highlighted: false })
        )
      })
    })

    describe('and the owner changes the image', () => {
      beforeEach(async () => {
        const events = await createEventsComponent(components)
        await events.updateEvent(
          '11111111-1111-4111-8111-111111111111',
          { image: 'https://cdn.example.org/new.png' },
          '0xowner',
          {}
        )
      })

      it('should re-queue the event for moderation by clearing approval', () => {
        expect(components.eventsRepository.update).toHaveBeenCalledWith(
          components.pg,
          '11111111-1111-4111-8111-111111111111',
          expect.objectContaining({ approved: false, approved_by: null, highlighted: false })
        )
      })
    })

    describe('and the owner changes the displayed creator name', () => {
      beforeEach(async () => {
        const events = await createEventsComponent(components)
        await events.updateEvent('11111111-1111-4111-8111-111111111111', { user_name: 'Impersonator' }, '0xowner', {})
      })

      it('should re-queue the event for moderation by clearing approval', () => {
        expect(components.eventsRepository.update).toHaveBeenCalledWith(
          components.pg,
          '11111111-1111-4111-8111-111111111111',
          expect.objectContaining({ approved: false, approved_by: null, highlighted: false })
        )
      })
    })

    describe('and the owner injects unsafe markup that sanitizes to the current description', () => {
      let patch: any

      beforeEach(async () => {
        const events = await createEventsComponent(components)
        await events.updateEvent(
          '11111111-1111-4111-8111-111111111111',
          { description: '<link="file:///etc/passwd">Original description</link>' },
          '0xowner',
          {}
        )
        patch = components.eventsRepository.update.mock.calls[0][2]
      })

      it('should keep the event approved since the visible content did not change', () => {
        expect(patch.approved).toBeUndefined()
      })

      it('should still persist the description sanitized, not the raw markup', () => {
        expect(patch.description).toBe('Original description')
      })
    })
  })

  describe('and creating an event whose description contains client-rendered markup', () => {
    beforeEach(() => {
      components.eventsRepository.create.mockImplementation(async (_c: unknown, row: any) => ({
        id: '11111111-1111-4111-8111-111111111111',
        ...row
      }))
    })

    it('should persist the description sanitized', async () => {
      const events = await createEventsComponent(components)
      await events.createEvent(
        {
          name: 'Party',
          start_at: new Date(Date.now() + 3600_000).toISOString(),
          x: 0,
          y: 0,
          description: 'Join <link="decentraland://?position=0,0">here</link> now'
        },
        '0xUSER'
      )

      expect(components.eventsRepository.create).toHaveBeenCalledWith(
        components.pg,
        expect.objectContaining({ description: 'Join here now' })
      )
    })
  })
})
