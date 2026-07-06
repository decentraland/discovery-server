import { createEventsComponent, EventValidationError } from '../../src/logic/events'
import { createRecurrenceComponent } from '../../src/logic/recurrence'

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
      config: { getString: jest.fn().mockResolvedValue(undefined) },
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
