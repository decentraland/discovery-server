import { createRecurrenceComponent, Frequency } from '../../src/logic/recurrence'
import type { RecurrentEventInput } from '../../src/logic/recurrence'

const DAY_MS = 24 * 60 * 60 * 1000

function baseInput(overrides: Partial<RecurrentEventInput> = {}): RecurrentEventInput {
  const start_at = new Date(Date.now() + DAY_MS)
  return {
    start_at,
    duration: 60 * 60 * 1000,
    finish_at: new Date(start_at.getTime() + 60 * 60 * 1000),
    recurrent: false,
    recurrent_frequency: null,
    recurrent_interval: 1,
    recurrent_setpos: null,
    recurrent_monthday: null,
    recurrent_weekday_mask: 0,
    recurrent_month_mask: 0,
    recurrent_until: null,
    recurrent_count: null,
    recurrent_dates: [],
    ...overrides
  }
}

describe('when calculating recurrent properties', () => {
  let recurrence: ReturnType<typeof createRecurrenceComponent>

  beforeEach(() => {
    recurrence = createRecurrenceComponent()
  })

  describe('and the event is not recurrent', () => {
    it('should fall back to a single occurrence at start_at', () => {
      const input = baseInput()
      const result = recurrence.calculateRecurrentProperties(input)

      expect(result.recurrent_dates).toEqual([input.start_at])
    })
  })

  describe('and the event is a daily recurrence with a count', () => {
    let input: RecurrentEventInput

    beforeEach(() => {
      input = baseInput({ recurrent: true, recurrent_frequency: Frequency.DAILY, recurrent_count: 5 })
    })

    it('should materialize up to the max number of future occurrences', () => {
      const result = recurrence.calculateRecurrentProperties(input)

      expect(result.recurrent_dates.length).toBeGreaterThan(1)
      expect(result.recurrent_dates.length).toBeLessThanOrEqual(10)
    })

    it('should mark the result as recurrent', () => {
      const result = recurrence.calculateRecurrentProperties(input)

      expect(result.recurrent).toBe(true)
    })
  })

  describe('and the interval is negative', () => {
    let input: RecurrentEventInput

    beforeEach(() => {
      // A negative interval would make rrule.between() loop forever without the clamp;
      // this test hangs (jest timeout) if the sanitizer regresses.
      input = baseInput({
        recurrent: true,
        recurrent_frequency: Frequency.DAILY,
        recurrent_count: 5,
        recurrent_interval: -2
      })
    })

    it('should clamp the interval and still materialize occurrences', () => {
      const result = recurrence.calculateRecurrentProperties(input)

      expect(result.recurrent_dates.length).toBeGreaterThan(1)
    })
  })

  describe('and a count of 0 is combined with an until bound', () => {
    let input: RecurrentEventInput

    beforeEach(() => {
      const start_at = new Date(Date.now() + DAY_MS)
      input = baseInput({
        start_at,
        finish_at: new Date(start_at.getTime() + 60 * 60 * 1000),
        recurrent: true,
        recurrent_frequency: Frequency.DAILY,
        recurrent_count: 0,
        recurrent_until: new Date(start_at.getTime() + 10 * DAY_MS)
      })
    })

    it('should treat the 0 count as unset and let the until bound drive the series', () => {
      const result = recurrence.calculateRecurrentProperties(input)

      expect(result.recurrent_dates.length).toBeGreaterThan(1)
    })
  })

  describe('and the recurrence has already ended', () => {
    let input: RecurrentEventInput

    beforeEach(() => {
      const start_at = new Date(Date.now() - 30 * DAY_MS)
      input = baseInput({
        start_at,
        finish_at: new Date(start_at.getTime() + 60 * 60 * 1000),
        recurrent: true,
        recurrent_frequency: Frequency.DAILY,
        recurrent_until: new Date(Date.now() - 10 * DAY_MS)
      })
    })

    it('should fall back to a single occurrence at start_at', () => {
      const result = recurrence.calculateRecurrentProperties(input)

      expect(result.recurrent_dates).toEqual([input.start_at])
    })
  })
})

describe('when estimating past iterations', () => {
  let recurrence: ReturnType<typeof createRecurrenceComponent>

  beforeEach(() => {
    recurrence = createRecurrenceComponent()
  })

  describe('and the rule has no terminating condition', () => {
    it('should return zero', () => {
      const iterations = recurrence.estimateRecurrentPastIterations(
        baseInput({ recurrent: true, recurrent_frequency: Frequency.DAILY })
      )

      expect(iterations).toBe(0)
    })
  })

  describe('and the rule is hourly anchored many years in the past', () => {
    it('should estimate an iteration count above the CPU guard', () => {
      const start_at = new Date(Date.now() - 10 * 365 * DAY_MS)
      const iterations = recurrence.estimateRecurrentPastIterations(
        baseInput({ start_at, recurrent: true, recurrent_frequency: Frequency.HOURLY, recurrent_until: new Date() })
      )

      expect(iterations).toBeGreaterThan(50_000)
    })
  })
})

describe('when calculating the next recurrent dates', () => {
  let recurrence: ReturnType<typeof createRecurrenceComponent>

  beforeEach(() => {
    recurrence = createRecurrenceComponent()
  })

  describe('and start_at is still in the future', () => {
    it('should use start_at as the next occurrence', () => {
      const start_at = new Date(Date.now() + DAY_MS)
      const result = recurrence.calculateNextRecurrentDates({
        start_at,
        duration: 3_600_000,
        recurrent_dates: [start_at]
      })

      expect(result.next_start_at).toEqual(start_at)
    })
  })

  describe('and start_at is already past but a future occurrence exists', () => {
    it('should pick the first future occurrence from recurrent_dates', () => {
      const past = new Date(Date.now() - DAY_MS)
      const future = new Date(Date.now() + DAY_MS)
      const result = recurrence.calculateNextRecurrentDates({
        start_at: past,
        duration: 3_600_000,
        recurrent_dates: [past, future]
      })

      expect(result.next_start_at).toEqual(future)
    })
  })
})
