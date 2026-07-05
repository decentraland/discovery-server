import type { Frequency } from './constants'

/** The recurrence-relevant fields of an event (Date-based, as the engine works). */
export type RecurrentEventInput = {
  start_at: Date
  duration: number
  finish_at: Date
  recurrent: boolean
  recurrent_frequency: Frequency | null
  recurrent_interval: number
  recurrent_setpos: number | null
  recurrent_monthday: number | null
  recurrent_weekday_mask: number
  recurrent_month_mask: number
  recurrent_until: Date | null
  recurrent_count: number | null
  recurrent_dates: Date[]
}

export type RecurrentProperties = RecurrentEventInput

export type NextRecurrentDates = {
  next_start_at: Date
  next_finish_at: Date
}

export interface IRecurrenceComponent {
  /** Materialize recurrent_dates + adjusted finish_at from a recurrence rule (falls back to [start_at]). */
  calculateRecurrentProperties(
    event: Partial<RecurrentEventInput> & Pick<RecurrentEventInput, 'start_at' | 'duration' | 'finish_at'>
  ): RecurrentProperties
  /** Compute the next upcoming occurrence window from materialized recurrent_dates. */
  calculateNextRecurrentDates(event: { start_at: Date; duration: number; recurrent_dates: Date[] }): NextRecurrentDates
  /** Upper-bound estimate of past occurrences rrule would walk (for the CPU guard). */
  estimateRecurrentPastIterations(
    options: Pick<
      RecurrentEventInput,
      'recurrent' | 'recurrent_frequency' | 'recurrent_interval' | 'recurrent_count' | 'recurrent_until' | 'start_at'
    >
  ): number
}
