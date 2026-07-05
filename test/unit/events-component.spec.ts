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
})
