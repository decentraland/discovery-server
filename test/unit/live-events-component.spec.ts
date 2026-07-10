import { createLiveEventsComponent } from '../../src/logic/live-events'

describe('when reading the live-events snapshot', () => {
  let eventsRepository: any
  let config: any
  let pg: any
  let logs: any
  let liveEvents: Awaited<ReturnType<typeof createLiveEventsComponent>>

  beforeEach(() => {
    pg = {}
    eventsRepository = {
      getLiveEntityIds: jest.fn().mockResolvedValue({ placeIds: ['p1'], worldIds: ['w1'] }),
      getAllNextEvents: jest
        .fn()
        .mockResolvedValue({ p1: { id: 'e1', name: 'Next', next_start_at: '2030-01-01T00:00:00Z' } })
    }
    // Long TTL so a second read within the test is a cache hit.
    config = { getNumber: jest.fn().mockResolvedValue(60_000) }
    logs = { getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and the snapshot is read for the first time', () => {
    let ids: { placeIds: string[]; worldIds: string[] }

    beforeEach(async () => {
      liveEvents = await createLiveEventsComponent({ pg, eventsRepository, config, logs })
      ids = await liveEvents.getLiveEntityIds()
    })

    it('should return the live entity ids from the repository', () => {
      expect(ids).toEqual({ placeIds: ['p1'], worldIds: ['w1'] })
    })

    it('should query the repository once', () => {
      expect(eventsRepository.getLiveEntityIds).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the next-event map is requested', () => {
    let map: Record<string, { id: string; name: string; next_start_at: string }>

    beforeEach(async () => {
      liveEvents = await createLiveEventsComponent({ pg, eventsRepository, config, logs })
      map = await liveEvents.getNextEventMap()
    })

    it('should return the earliest upcoming event per entity from the repository', () => {
      expect(map.p1).toEqual({ id: 'e1', name: 'Next', next_start_at: '2030-01-01T00:00:00Z' })
    })
  })

  describe('and the snapshot is read twice within the TTL', () => {
    beforeEach(async () => {
      liveEvents = await createLiveEventsComponent({ pg, eventsRepository, config, logs })
      await liveEvents.getLiveEntityIds()
      await liveEvents.getNextEventMap()
    })

    it('should reuse the cached snapshot instead of re-querying', () => {
      expect(eventsRepository.getLiveEntityIds).toHaveBeenCalledTimes(1)
    })
  })

  describe('and refresh is called explicitly after a read', () => {
    beforeEach(async () => {
      liveEvents = await createLiveEventsComponent({ pg, eventsRepository, config, logs })
      await liveEvents.getLiveEntityIds()
      await liveEvents.refresh()
    })

    it('should re-query the repository', () => {
      expect(eventsRepository.getLiveEntityIds).toHaveBeenCalledTimes(2)
    })
  })
})
