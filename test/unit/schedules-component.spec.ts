import { createSchedulesComponent } from '../../src/logic/schedules'
import { ScheduleNotFoundError } from '../../src/logic/schedules'
import type { ISchedulesRepository } from '../../src/adapters/schedules-repository'
import type { Schedule } from '../../src/types/entities'

describe('when getting schedules', () => {
  let schedulesRepository: jest.Mocked<ISchedulesRepository>
  let pg: any
  let logs: any

  beforeEach(() => {
    schedulesRepository = {
      findActive: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    }
    pg = {}
    logs = { getLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) }
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and requesting a schedule that exists', () => {
    let schedule: Schedule

    beforeEach(() => {
      schedule = {
        id: 'e5b8b1a0-0000-0000-0000-000000000001',
        name: 'Pride',
        description: null,
        image: null,
        theme: null,
        background: [],
        active: true,
        active_since: '2026-06-01T00:00:00.000Z',
        active_until: '2026-07-01T00:00:00.000Z',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z'
      }
      schedulesRepository.findById.mockResolvedValueOnce(schedule)
    })

    it('should return the schedule', async () => {
      const schedules = await createSchedulesComponent({ pg, schedulesRepository, logs })
      const result = await schedules.getScheduleById(schedule.id)

      expect(result).toEqual(schedule)
    })
  })

  describe('and requesting a schedule that does not exist', () => {
    beforeEach(() => {
      schedulesRepository.findById.mockResolvedValueOnce(null)
    })

    it('should throw a ScheduleNotFoundError', async () => {
      const schedules = await createSchedulesComponent({ pg, schedulesRepository, logs })

      await expect(schedules.getScheduleById('missing')).rejects.toThrow(ScheduleNotFoundError)
    })
  })
})
