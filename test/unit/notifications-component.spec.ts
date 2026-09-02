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
        getCommunity: jest.fn().mockResolvedValue(null),
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

  describe('and notifying the creator that their event was approved', () => {
    let event: any

    beforeEach(() => {
      event = { id: 'e1', user: '0xowner', name: 'Party', description: 'desc', image: 'img' }
    })

    it('should publish a single event-approved notification with the creator and a link', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyEventApproved(event)

      const published = publish.mock.calls[0][0]
      expect(published).toHaveLength(1)
      expect(published[0]).toEqual(
        expect.objectContaining({
          subType: 'event-approved',
          key: 'e1',
          metadata: expect.objectContaining({
            host: '0xowner',
            title: 'Party',
            link: 'https://events.decentraland.org/event/e1'
          })
        })
      )
    })
  })

  describe('and notifying the creator that their event was rejected', () => {
    let event: any

    beforeEach(() => {
      event = { id: 'e1', user: '0xowner', name: 'Party', description: 'desc', image: 'img' }
    })

    it('should publish a single event-rejected notification carrying the reason', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyEventRejected(event, 'spam')

      const published = publish.mock.calls[0][0]
      expect(published[0]).toEqual(
        expect.objectContaining({
          subType: 'event-rejected',
          metadata: expect.objectContaining({ host: '0xowner', reason: 'spam' })
        })
      )
    })
  })

  describe('and notifying the creator that their event was deleted', () => {
    let event: any

    beforeEach(() => {
      event = { id: 'e1', user: '0xowner', name: 'Party', description: 'desc', image: 'img' }
    })

    it('should include the reason when one is given', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyEventDeleted(event, 'inappropriate')

      const published = publish.mock.calls[0][0]
      expect(published[0]).toEqual(
        expect.objectContaining({
          subType: 'event-deleted',
          metadata: expect.objectContaining({ host: '0xowner', reason: 'inappropriate' })
        })
      )
    })

    it('should omit the reason when none is given', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyEventDeleted(event)

      const published = publish.mock.calls[0][0]
      expect(published[0].metadata).not.toHaveProperty('reason')
    })
  })

  describe('and the event description contains client-rendered markup', () => {
    let event: any

    beforeEach(() => {
      event = {
        id: 'e1',
        user: '0xowner',
        name: 'Party',
        description: 'Join <link="decentraland://?position=0,0">here</link> now',
        image: 'img'
      }
    })

    it('should strip the unsafe markup from the notification description', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyEventApproved(event)

      const published = publish.mock.calls[0][0]
      expect(published[0].metadata.description).toBe('Join here now')
    })
  })

  describe('and fanning a community-event notification out on approval', () => {
    let event: any

    beforeEach(() => {
      event = { id: 'e1', user: '0xowner', name: 'Party', image: 'img', community_id: 'community-1' }
      components.communitiesClient.enabled = true
      components.communitiesClient.getCommunity.mockResolvedValue({
        id: 'community-1',
        name: 'Builders',
        thumbnailRaw: 'https://cdn.example.org/thumb.png'
      })
      components.communitiesClient.getCommunityMembers.mockResolvedValue(['0xaaa', '0xbbb'])
    })

    it('should publish one EVENT_CREATED per community member', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyCommunityEventPublished(event)

      const published = publish.mock.calls[0][0]
      expect(published).toHaveLength(2)
      expect(published[0]).toEqual(
        expect.objectContaining({
          subType: 'event-created',
          metadata: expect.objectContaining({
            title: 'Community Event Added',
            communityName: 'Builders',
            communityThumbnail: 'https://cdn.example.org/thumb.png',
            attendee: '0xaaa'
          })
        })
      )
    })

    it('should be a no-op when the event has no community', async () => {
      const notifications = await createNotificationsComponent(components)
      await notifications.notifyCommunityEventPublished({ ...event, community_id: null })

      expect(publish).not.toHaveBeenCalled()
    })

    describe('and the community metadata carries markup and an unsafe thumbnail', () => {
      let metadata: any

      beforeEach(async () => {
        components.communitiesClient.getCommunity.mockResolvedValue({
          id: 'community-1',
          // A name is a plain-text label, so even a *safe* link tag must be stripped (not kept
          // as clickable markup the way a description would keep it).
          name: 'Evil <link="https://evil.example">Squad</link>',
          thumbnailRaw: 'javascript:alert(1)'
        })
        const notifications = await createNotificationsComponent(components)
        await notifications.notifyCommunityEventPublished(event)
        metadata = publish.mock.calls[0][0][0].metadata
      })

      it('should reduce the community name to plain text in the description', () => {
        expect(metadata.description).toBe('The Evil Squad Community has added a new event.')
      })

      it('should reduce the community name to plain text in communityName', () => {
        expect(metadata.communityName).toBe('Evil Squad')
      })

      it('should drop the unsafe community thumbnail', () => {
        expect(metadata.communityThumbnail).toBeUndefined()
      })
    })
  })
})
