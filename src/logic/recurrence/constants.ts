/** Recurrence constants, carried over verbatim from the events service. */

export enum Frequency {
  YEARLY = 'YEARLY',
  MONTHLY = 'MONTHLY',
  WEEKLY = 'WEEKLY',
  DAILY = 'DAILY',
  HOURLY = 'HOURLY',
  MINUTELY = 'MINUTELY',
  SECONDLY = 'SECONDLY'
}

// Frequencies an API client may submit; sub-hourly rules expand to enormous
// iteration counts and have no product use case.
export const AllowedInputFrequencies = [
  Frequency.YEARLY,
  Frequency.MONTHLY,
  Frequency.WEEKLY,
  Frequency.DAILY,
  Frequency.HOURLY
]

export enum WeekdayMask {
  NONE = 0,
  SUNDAY = 1 << 0,
  MONDAY = 1 << 1,
  TUESDAY = 1 << 2,
  WEDNESDAY = 1 << 3,
  THURSDAY = 1 << 4,
  FRIDAY = 1 << 5,
  SATURDAY = 1 << 6,
  ALL = 0b1111111
}

export const Weekdays = [
  WeekdayMask.SUNDAY,
  WeekdayMask.MONDAY,
  WeekdayMask.TUESDAY,
  WeekdayMask.WEDNESDAY,
  WeekdayMask.THURSDAY,
  WeekdayMask.FRIDAY,
  WeekdayMask.SATURDAY
]

export enum MonthMask {
  NONE = 0,
  JANUARY = 1 << 0,
  FEBRUARY = 1 << 1,
  MARCH = 1 << 2,
  APRIL = 1 << 3,
  MAY = 1 << 4,
  JUNE = 1 << 5,
  JULY = 1 << 6,
  AUGUST = 1 << 7,
  SEPTEMBER = 1 << 8,
  OCTOBER = 1 << 9,
  NOVEMBER = 1 << 10,
  DECEMBER = 1 << 11,
  ALL = 0b111111111111
}

export const Months = [
  MonthMask.JANUARY,
  MonthMask.FEBRUARY,
  MonthMask.MARCH,
  MonthMask.APRIL,
  MonthMask.MAY,
  MonthMask.JUNE,
  MonthMask.JULY,
  MonthMask.AUGUST,
  MonthMask.SEPTEMBER,
  MonthMask.OCTOBER,
  MonthMask.NOVEMBER,
  MonthMask.DECEMBER
]

export const MAX_EVENT_RECURRENT = 10

// Upper bound on how many past occurrences rrule is asked to step through.
export const MAX_RECURRENT_PAST_ITERATIONS = 50_000

export const FREQUENCY_PERIOD_MS: Record<Frequency, number> = {
  [Frequency.SECONDLY]: 1_000,
  [Frequency.MINUTELY]: 60 * 1_000,
  [Frequency.HOURLY]: 60 * 60 * 1_000,
  [Frequency.DAILY]: 24 * 60 * 60 * 1_000,
  [Frequency.WEEKLY]: 7 * 24 * 60 * 60 * 1_000,
  [Frequency.MONTHLY]: 30 * 24 * 60 * 60 * 1_000,
  [Frequency.YEARLY]: 365 * 24 * 60 * 60 * 1_000
}
