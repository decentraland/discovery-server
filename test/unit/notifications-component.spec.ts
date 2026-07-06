import { createNotificationsComponent } from '../../src/logic/notifications'

describe('when running the notification crons', () => {
  let components: any
  let publish: jest.Mock

  beforeEach(() => {
    publish = jest.fn().mockResolvedValue({ published: 0, failed: 0 })
    components = {
      pg: {},
      eventsRepository: {
        findInStartWindow: jest.fn().mockResolvedValue([]),
        findInFinishWindow: jest.fn().mockResolvedValue([])
      },
      attendeesRepository: { listByEvent: jest.fn().mockResolvedValue([]) },
      notificationCursorsRepository: {
        get: jest.fn().mockResolvedValue({ last_successful_run_at: 1000 }),
        set: jest.fn()
      },
      snsPublisher: { enabled: true, publish },
      communitiesClient: {
        enabled: false,
        getManagedCommunities: jest.fn().mockResolvedValue([]),
        getCommunityMembers: jest.fn().mockResolvedValue([])
      },
      config: { getString: jest.fn().mockResolvedValue('https://events.decentraland.org') },
      logs: { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
    }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and events just started with attendees', () => {
    beforeEach(() => {
      const now = new Date()
      components.eventsRepository.findInStartWindow.mockResolvedValueOnce([
        {
          id: 'e1',
          name: 'Party',
          image: 'img',
          description: 'desc',
          start_at: now,
          finish_at: now,
          next_start_at: now,
          next_finish_at: now,
          total_attendees: 2,
          community_id: null
        }
      ])
      components.attendeesRepository.listByEvent.mockResolvedValueOnce([{ user: '0xaaa' }, { user: '0xbbb' }])
    })

    it('should publish one EVENT_STARTED per attendee', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyStarted()

      const published = publish.mock.calls[0][0]
      expect(published).toHaveLength(2)
      expect(published[0]).toEqual(
        expect.objectContaining({ subType: 'event-started', metadata: expect.objectContaining({ attendee: '0xaaa' }) })
      )
    })

    it('should advance the events_started cursor', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyStarted()

      expect(components.notificationCursorsRepository.set).toHaveBeenCalledWith(
        components.pg,
        'events_started',
        expect.any(Number)
      )
    })
  })

  describe('and an SNS publish batch fails', () => {
    beforeEach(() => {
      const now = new Date()
      publish.mockResolvedValue({ published: 0, failed: 2 })
      components.eventsRepository.findInStartWindow.mockResolvedValueOnce([
        {
          id: 'e1',
          name: 'Party',
          image: 'img',
          description: 'desc',
          start_at: now,
          finish_at: now,
          next_start_at: now,
          next_finish_at: now,
          total_attendees: 2,
          community_id: null
        }
      ])
      components.attendeesRepository.listByEvent.mockResolvedValueOnce([{ user: '0xaaa' }, { user: '0xbbb' }])
    })

    it('should not advance the cursor so the window is retried', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyStarted()

      expect(components.notificationCursorsRepository.set).not.toHaveBeenCalled()
    })
  })

  describe('and a started event is attached to a community', () => {
    beforeEach(() => {
      const now = new Date()
      components.communitiesClient.enabled = true
      components.eventsRepository.findInStartWindow.mockResolvedValueOnce([
        {
          id: 'e1',
          name: 'Party',
          image: 'img',
          description: 'desc',
          start_at: now,
          finish_at: now,
          next_start_at: now,
          next_finish_at: now,
          total_attendees: 1,
          community_id: 'c1'
        }
      ])
      components.attendeesRepository.listByEvent.mockResolvedValueOnce([{ user: '0xAAA' }])
      components.communitiesClient.getCommunityMembers.mockResolvedValueOnce(['0xaaa', '0xbbb'])
    })

    it('should notify the union of attendees and community members exactly once each', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyStarted()

      const published = publish.mock.calls[0][0]
      const recipients = published.map((p: any) => p.metadata.attendee).sort()
      expect(recipients).toEqual(['0xaaa', '0xbbb'])
    })

    it('should stamp the community id on every published notification', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyStarted()

      const published = publish.mock.calls[0][0]
      expect(published.every((p: any) => p.metadata.communityId === 'c1')).toBe(true)
    })
  })

  describe('and events just ended', () => {
    beforeEach(() => {
      const now = new Date()
      components.eventsRepository.findInFinishWindow.mockResolvedValueOnce([
        { id: 'e1', name: 'Party', next_finish_at: now, total_attendees: 42, community_id: 'c1' }
      ])
    })

    it('should publish a single system EVENT_ENDED carrying the attendee total', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyEnded()

      const published = publish.mock.calls[0][0]
      expect(published).toHaveLength(1)
      expect(published[0]).toEqual(
        expect.objectContaining({
          subType: 'event-ended',
          metadata: expect.objectContaining({ totalAttendees: 42, communityId: 'c1' })
        })
      )
    })
  })

  describe('and nothing is in the window', () => {
    it('should still advance the cursor without publishing', async () => {
      const notifications = await createNotificationsComponent(components)
      const published = await notifications.notifyStarted()

      expect(published).toBe(0)
      expect(components.notificationCursorsRepository.set).toHaveBeenCalled()
    })
  })
})
