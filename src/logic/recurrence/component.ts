import { RRule, Weekday } from 'rrule'
import { FREQUENCY_PERIOD_MS, MAX_EVENT_RECURRENT, MonthMask, WeekdayMask } from './constants'
import type { IRecurrenceComponent, NextRecurrentDates, RecurrentEventInput, RecurrentProperties } from './types'

function toRRuleMonths(mask: number): number[] {
  return [
    mask & MonthMask.JANUARY && 1,
    mask & MonthMask.FEBRUARY && 2,
    mask & MonthMask.MARCH && 3,
    mask & MonthMask.APRIL && 4,
    mask & MonthMask.MAY && 5,
    mask & MonthMask.JUNE && 6,
    mask & MonthMask.JULY && 7,
    mask & MonthMask.AUGUST && 8,
    mask & MonthMask.SEPTEMBER && 9,
    mask & MonthMask.OCTOBER && 10,
    mask & MonthMask.NOVEMBER && 11,
    mask & MonthMask.DECEMBER && 12
  ].filter(Boolean) as number[]
}

function toRRuleWeekdays(mask: number): Weekday[] {
  return [
    mask & WeekdayMask.SUNDAY && RRule.SU,
    mask & WeekdayMask.MONDAY && RRule.MO,
    mask & WeekdayMask.TUESDAY && RRule.TU,
    mask & WeekdayMask.WEDNESDAY && RRule.WE,
    mask & WeekdayMask.THURSDAY && RRule.TH,
    mask & WeekdayMask.FRIDAY && RRule.FR,
    mask & WeekdayMask.SATURDAY && RRule.SA
  ].filter(Boolean) as Weekday[]
}

/**
 * Coerce the interval to a positive integer. A negative or non-numeric interval makes
 * `rrule.between()` loop forever (blocking the single-threaded event loop), which the
 * past-iterations guard doesn't catch, so clamp it defensively at the engine boundary.
 */
function sanitizeInterval(value: number | null | undefined): number {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function toRRule(options: RecurrentEventInput): RRule | null {
  if (
    !options.start_at ||
    !options.recurrent ||
    !options.recurrent_frequency ||
    (!options.recurrent_count && !options.recurrent_until)
  ) {
    return null
  }

  return new RRule({
    dtstart: options.start_at,
    freq: RRule[options.recurrent_frequency],
    interval: sanitizeInterval(options.recurrent_interval),
    until: options.recurrent_until ?? undefined,
    count: options.recurrent_count ?? undefined,
    byweekday: options.recurrent_weekday_mask ? toRRuleWeekdays(options.recurrent_weekday_mask) : undefined,
    bymonth: options.recurrent_month_mask ? toRRuleMonths(options.recurrent_month_mask) : undefined,
    bysetpos: options.recurrent_setpos ?? undefined,
    bymonthday: options.recurrent_monthday ?? undefined
  })
}

function futureRecurrentDates(options: RecurrentEventInput): Date[] {
  const rrule = toRRule(options)
  if (!rrule) return []

  const now = new Date()
  const end = options.recurrent_until ?? new Date(Date.UTC(9999, 11, 31))
  if (end < now) return []

  // rrule preserves the dtstart (start_at) UTC time-of-day on every occurrence, so the
  // returned dates need no time re-stamping (pinned by the time-of-day preservation test).
  return rrule.between(now, end, true, (_date, len) => len < MAX_EVENT_RECURRENT)
}

/**
 * Pure recurrence engine — an exact port of the events service's rrule logic.
 * No dependencies (WKC logic components may be pure).
 */
export function createRecurrenceComponent(): IRecurrenceComponent {
  function estimateRecurrentPastIterations(
    options: Pick<
      RecurrentEventInput,
      'recurrent' | 'recurrent_frequency' | 'recurrent_interval' | 'recurrent_count' | 'recurrent_until' | 'start_at'
    >
  ): number {
    if (!options.recurrent || !options.recurrent_frequency) return 0
    if (!options.recurrent_count && !options.recurrent_until) return 0

    const period = FREQUENCY_PERIOD_MS[options.recurrent_frequency] * (options.recurrent_interval || 1)
    const now = Date.now()
    const timeBound = options.recurrent_until ? Math.min(now, options.recurrent_until.getTime()) : now
    const span = Math.max(0, timeBound - options.start_at.getTime())
    const byTime = span / period
    const byCount = options.recurrent_count ?? Number.POSITIVE_INFINITY
    return Math.min(byTime, byCount)
  }

  function calculateRecurrentProperties(
    event: Partial<RecurrentEventInput> & Pick<RecurrentEventInput, 'start_at' | 'duration' | 'finish_at'>
  ): RecurrentProperties {
    const now = Date.now()
    const start_at = new Date(event.start_at)
    const duration = Math.max(event.duration, 0)
    const finish_at = new Date(start_at.getTime() + duration)
    const previous_recurrent_dates =
      (event.recurrent && (event.recurrent_dates || []).filter((date) => date.getTime() + duration <= now)) || []

    const recurrent: RecurrentProperties = {
      start_at,
      duration,
      finish_at,
      recurrent: false,
      recurrent_interval: 1,
      recurrent_frequency: null,
      recurrent_setpos: null,
      recurrent_monthday: null,
      recurrent_weekday_mask: 0,
      recurrent_month_mask: 0,
      recurrent_until: null,
      recurrent_count: null,
      recurrent_dates: previous_recurrent_dates
    }

    if (event.recurrent && event.recurrent_frequency && (event.recurrent_count || event.recurrent_until)) {
      recurrent.recurrent = event.recurrent
      recurrent.recurrent_interval = sanitizeInterval(event.recurrent_interval)
      recurrent.recurrent_frequency = event.recurrent_frequency
      // `|| null` (not `?? null`) so a 0 means "unset" — 0 is not a valid rrule
      // setpos/monthday (it throws / yields no dates) and 0 count means "no limit".
      recurrent.recurrent_setpos = event.recurrent_setpos || null
      recurrent.recurrent_monthday = event.recurrent_monthday || null
      recurrent.recurrent_weekday_mask = event.recurrent_weekday_mask || 0
      recurrent.recurrent_month_mask = event.recurrent_month_mask || 0
      recurrent.recurrent_count = event.recurrent_count || null
      recurrent.recurrent_until = event.recurrent_until ? new Date(event.recurrent_until) : null

      const recurrent_dates = futureRecurrentDates(recurrent)
      if (recurrent_dates.length) {
        const last_date = recurrent_dates[recurrent_dates.length - 1]
        recurrent.recurrent_dates = recurrent_dates
        recurrent.finish_at = new Date(last_date.getTime() + duration)
      }
    }

    if (recurrent.recurrent_dates.length === 0) {
      recurrent.recurrent_dates.push(start_at)
    }

    return recurrent
  }

  function calculateNextRecurrentDates(event: {
    start_at: Date
    duration: number
    recurrent_dates: Date[]
  }): NextRecurrentDates {
    const now = Date.now()
    let next = event.start_at

    if (!next || next.getTime() + event.duration <= now) {
      next =
        event.recurrent_dates.find((date) => date.getTime() + event.duration > now) ||
        event.recurrent_dates[event.recurrent_dates.length - 1]
    }

    return { next_start_at: next, next_finish_at: new Date(next.getTime() + event.duration) }
  }

  return { calculateRecurrentProperties, calculateNextRecurrentDates, estimateRecurrentPastIterations }
}
