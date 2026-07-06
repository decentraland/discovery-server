import type { AppComponents } from '../../types'
import type { Event } from '../../types/entities'
import { ProfilePermission as Permission } from '../../types/entities'
import type { EventListFilters, CreateEventRow, UpdateEventRow } from '../../adapters/events-repository'
import { AllowedInputFrequencies, MAX_RECURRENT_PAST_ITERATIONS } from '../recurrence'
import type { RecurrentEventInput } from '../recurrence'
import { EventNotFoundError, EventUnauthorizedActionError, EventValidationError } from './errors'
import type { CreateEventPayload, EventWithAttendance, IEventsComponent, UpdateEventPayload } from './types'

const MAX_EVENT_DURATION_MS = 24 * 60 * 60 * 1000

// Fields whose change requires re-materializing recurrence + the next window.
const RECURRENCE_KEYS: Array<keyof UpdateEventPayload> = [
  'start_at',
  'finish_at',
  'duration',
  'recurrent',
  'recurrent_frequency',
  'recurrent_interval',
  'recurrent_setpos',
  'recurrent_monthday',
  'recurrent_weekday_mask',
  'recurrent_month_mask',
  'recurrent_until',
  'recurrent_count'
]

/**
 * Event orchestration. Recurrence is materialized in-process via the recurrence
 * engine; the target place/world is resolved in-process via the places/worlds
 * logic (replacing the legacy HTTP Places-API client, null-tolerant on a miss);
 * approval is gated by profile permissions. Responses serve the legacy contract
 * of `place_id = COALESCE(place_id, world_id)` so world events keep a non-null
 * `place_id`. Community validation stays a follow-up (needs the communities
 * client — see the note in createEvent).
 */
export async function createEventsComponent(
  components: Pick<
    AppComponents,
    'pg' | 'eventsRepository' | 'attendeesRepository' | 'places' | 'worlds' | 'profiles' | 'recurrence' | 'logs'
  >
): Promise<IEventsComponent> {
  const { pg, eventsRepository, attendeesRepository, places, worlds, profiles, recurrence } = components

  // Legacy contract: the `place_id` field carries the world id for world events.
  function serialize(event: Event): Event {
    return { ...event, place_id: event.place_id ?? event.world_id }
  }

  async function resolveLocation(
    payload: Pick<CreateEventPayload, 'x' | 'y' | 'server' | 'world'>
  ): Promise<{ place_id: string | null; world_id: string | null; world: boolean }> {
    // A world event is signalled explicitly by `world: true` (matching the legacy
    // flag); presence of `server` alone does not make a genesis event a world.
    if (payload.world === true && payload.server) {
      const { data } = await worlds.getWorlds({ names: [payload.server], limit: 1 })
      return { place_id: null, world_id: data[0]?.id ?? null, world: true }
    }
    const position = `${payload.x ?? 0},${payload.y ?? 0}`
    const { data } = await places.getPlaces({ positions: [position], limit: 1 })
    return { place_id: data[0]?.id ?? null, world_id: null, world: false }
  }

  // Validate + materialize recurrence for a create or an update (shared).
  function buildRecurrence(input: {
    start_at: Date
    duration: number
    recurrent?: boolean
    recurrent_frequency?: RecurrentEventInput['recurrent_frequency']
    recurrent_interval?: number
    recurrent_setpos?: number | null
    recurrent_monthday?: number | null
    recurrent_weekday_mask?: number
    recurrent_month_mask?: number
    recurrent_until?: Date | null
    recurrent_count?: number | null
    recurrent_dates?: Date[]
  }): {
    props: ReturnType<typeof recurrence.calculateRecurrentProperties>
    next: ReturnType<typeof recurrence.calculateNextRecurrentDates>
  } {
    if (input.recurrent && input.recurrent_frequency && !AllowedInputFrequencies.includes(input.recurrent_frequency)) {
      throw new EventValidationError(`unsupported recurrent_frequency: ${input.recurrent_frequency}`)
    }
    const guardInput = {
      recurrent: input.recurrent ?? false,
      recurrent_frequency: input.recurrent_frequency ?? null,
      recurrent_interval: input.recurrent_interval ?? 1,
      recurrent_count: input.recurrent_count ?? null,
      recurrent_until: input.recurrent_until ?? null,
      start_at: input.start_at
    }
    if (recurrence.estimateRecurrentPastIterations(guardInput as never) > MAX_RECURRENT_PAST_ITERATIONS) {
      throw new EventValidationError('recurrence rule expands to too many past iterations')
    }
    try {
      const props = recurrence.calculateRecurrentProperties({
        start_at: input.start_at,
        duration: input.duration,
        finish_at: new Date(input.start_at.getTime() + input.duration),
        recurrent: input.recurrent ?? false,
        recurrent_frequency: input.recurrent_frequency ?? null,
        recurrent_interval: input.recurrent_interval ?? 1,
        recurrent_setpos: input.recurrent_setpos ?? null,
        recurrent_monthday: input.recurrent_monthday ?? null,
        recurrent_weekday_mask: input.recurrent_weekday_mask ?? 0,
        recurrent_month_mask: input.recurrent_month_mask ?? 0,
        recurrent_until: input.recurrent_until ?? null,
        recurrent_count: input.recurrent_count ?? null,
        recurrent_dates: input.recurrent_dates ?? []
      })
      const next = recurrence.calculateNextRecurrentDates({
        start_at: props.start_at,
        duration: props.duration,
        recurrent_dates: props.recurrent_dates
      })
      return { props, next }
    } catch {
      throw new EventValidationError('invalid recurrence rule')
    }
  }

  function visibleToUser(event: Event, user?: string, isAdmin = false): boolean {
    if (event.deleted_at && !isAdmin && event.user !== user) return false
    if ((!event.approved || event.rejected) && !isAdmin && event.user !== user) return false
    return true
  }

  async function getEvent(id: string, user?: string, isAdmin = false): Promise<EventWithAttendance> {
    const event = await eventsRepository.findById(pg, id)
    if (!event || !visibleToUser(event, user, isAdmin)) {
      throw new EventNotFoundError(id)
    }
    const attending = user ? await attendeesRepository.isAttending(pg, id, user) : false
    return { ...serialize(event), attending }
  }

  async function getEvents(filters: EventListFilters): Promise<{ data: Event[]; total: number }> {
    const [data, total] = await Promise.all([eventsRepository.list(pg, filters), eventsRepository.count(pg, filters)])
    return { data: data.map(serialize), total }
  }

  async function getAttendingEvents(user: string): Promise<Event[]> {
    const data = await eventsRepository.listAttending(pg, user)
    return data.map(serialize)
  }

  async function createEvent(payload: CreateEventPayload, user: string): Promise<Event> {
    if (!payload.name) throw new EventValidationError('name is required')
    if (!payload.start_at) throw new EventValidationError('start_at is required')

    const start_at = new Date(payload.start_at)
    if (Number.isNaN(start_at.getTime())) throw new EventValidationError('start_at is invalid')

    const duration =
      payload.duration ?? (payload.finish_at ? new Date(payload.finish_at).getTime() - start_at.getTime() : 0)
    if (duration < 0) throw new EventValidationError('duration must be non-negative')
    if (duration > MAX_EVENT_DURATION_MS) throw new EventValidationError('duration exceeds the maximum of one day')

    const { props, next } = buildRecurrence({
      start_at,
      duration,
      recurrent: payload.recurrent,
      recurrent_frequency: payload.recurrent_frequency ?? null,
      recurrent_interval: payload.recurrent_interval,
      recurrent_setpos: payload.recurrent_setpos,
      recurrent_monthday: payload.recurrent_monthday,
      recurrent_weekday_mask: payload.recurrent_weekday_mask,
      recurrent_month_mask: payload.recurrent_month_mask,
      recurrent_until: payload.recurrent_until ? new Date(payload.recurrent_until) : null,
      recurrent_count: payload.recurrent_count ?? null
    })

    const location = await resolveLocation(payload)
    const canApprove = await profiles.hasAnyPermission(user, [Permission.ApproveOwnEvent, Permission.ApproveAnyEvent])

    // NOTE: community_id is stored unvalidated. Ownership/membership validation is
    // a follow-up that needs the communities client (not yet built).
    const row: CreateEventRow = {
      name: payload.name,
      image: payload.image ?? null,
      image_vertical: payload.image_vertical ?? null,
      description: payload.description ?? null,
      start_at: props.start_at,
      finish_at: props.finish_at,
      duration: props.duration,
      all_day: payload.all_day ?? false,
      next_start_at: next.next_start_at,
      next_finish_at: next.next_finish_at,
      recurrent: props.recurrent,
      recurrent_frequency: props.recurrent_frequency,
      recurrent_setpos: props.recurrent_setpos,
      recurrent_monthday: props.recurrent_monthday,
      recurrent_weekday_mask: props.recurrent_weekday_mask,
      recurrent_month_mask: props.recurrent_month_mask,
      recurrent_interval: props.recurrent_interval,
      recurrent_count: props.recurrent_count,
      recurrent_until: props.recurrent_until,
      recurrent_dates: props.recurrent_dates,
      x: payload.x ?? 0,
      y: payload.y ?? 0,
      server: payload.server ?? null,
      world: location.world,
      estate_id: payload.estate_id ?? null,
      estate_name: payload.estate_name ?? null,
      scene_name: payload.scene_name ?? null,
      place_id: location.place_id,
      world_id: location.world_id,
      community_id: payload.community_id ?? null,
      url: payload.url ?? null,
      user: user.toLowerCase(),
      user_name: payload.user_name ?? null,
      contact: payload.contact ?? null,
      details: payload.details ?? null,
      approved: canApprove,
      rejected: false,
      approved_by: canApprove ? user.toLowerCase() : null,
      rejected_by: null,
      rejection_reason: null,
      highlighted: false,
      total_attendees: 0,
      latest_attendees: [],
      categories: payload.categories ?? [],
      schedules: payload.schedules ?? []
    }

    return serialize(await eventsRepository.create(pg, row))
  }

  async function assertCanModify(event: Event, user: string): Promise<void> {
    if (event.user === user.toLowerCase()) return
    const allowed = await profiles.hasAnyPermission(user, [Permission.EditAnyEvent, Permission.ApproveAnyEvent])
    if (!allowed) throw new EventUnauthorizedActionError()
  }

  const CONTENT_KEYS: Array<keyof UpdateEventPayload> = [
    'description',
    'image',
    'image_vertical',
    'contact',
    'details',
    'url',
    'all_day',
    'categories',
    'schedules',
    'estate_id',
    'estate_name',
    'scene_name',
    'community_id',
    'user_name'
  ]

  async function updateEvent(id: string, patch: UpdateEventPayload, user: string): Promise<Event> {
    const event = await eventsRepository.findById(pg, id)
    if (!event) throw new EventNotFoundError(id)
    await assertCanModify(event, user)

    const update: UpdateEventRow = {}

    // name is NOT NULL — only apply a non-empty string.
    if (typeof patch.name === 'string' && patch.name.length > 0) update.name = patch.name
    for (const key of CONTENT_KEYS) {
      if (key in patch) (update as Record<string, unknown>)[key] = patch[key]
    }

    // Timing / recurrence: recompute the materialized window from the merged rule.
    if (RECURRENCE_KEYS.some((key) => key in patch)) {
      const start_at = patch.start_at ? new Date(patch.start_at) : event.start_at
      const duration =
        patch.duration ?? (patch.finish_at ? new Date(patch.finish_at).getTime() - start_at.getTime() : event.duration)
      if (duration < 0) throw new EventValidationError('duration must be non-negative')
      if (duration > MAX_EVENT_DURATION_MS) throw new EventValidationError('duration exceeds the maximum of one day')

      const { props, next } = buildRecurrence({
        start_at,
        duration,
        recurrent: patch.recurrent ?? event.recurrent,
        recurrent_frequency: (patch.recurrent_frequency ??
          event.recurrent_frequency) as RecurrentEventInput['recurrent_frequency'],
        recurrent_interval: patch.recurrent_interval ?? event.recurrent_interval,
        recurrent_setpos: patch.recurrent_setpos ?? event.recurrent_setpos,
        recurrent_monthday: patch.recurrent_monthday ?? event.recurrent_monthday,
        recurrent_weekday_mask: patch.recurrent_weekday_mask ?? event.recurrent_weekday_mask,
        recurrent_month_mask: patch.recurrent_month_mask ?? event.recurrent_month_mask,
        recurrent_until: patch.recurrent_until ? new Date(patch.recurrent_until) : event.recurrent_until,
        recurrent_count: patch.recurrent_count ?? event.recurrent_count
      })
      Object.assign(update, {
        start_at: props.start_at,
        finish_at: props.finish_at,
        duration: props.duration,
        recurrent: props.recurrent,
        recurrent_frequency: props.recurrent_frequency,
        recurrent_setpos: props.recurrent_setpos,
        recurrent_monthday: props.recurrent_monthday,
        recurrent_weekday_mask: props.recurrent_weekday_mask,
        recurrent_month_mask: props.recurrent_month_mask,
        recurrent_interval: props.recurrent_interval,
        recurrent_count: props.recurrent_count,
        recurrent_until: props.recurrent_until,
        recurrent_dates: props.recurrent_dates,
        next_start_at: next.next_start_at,
        next_finish_at: next.next_finish_at
      })
    }

    // Moderation fields (approve/reject/highlight): only for holders of the
    // relevant permission (ApproveAnyEvent, or ApproveOwnEvent on one's own event).
    const isOwner = event.user === user.toLowerCase()
    const canModerate =
      (await profiles.hasAnyPermission(user, [Permission.ApproveAnyEvent])) ||
      (isOwner && (await profiles.hasAnyPermission(user, [Permission.ApproveOwnEvent])))
    if (canModerate) {
      if (patch.approved !== undefined) {
        update.approved = patch.approved
        update.approved_by = user.toLowerCase()
      }
      if (patch.rejected !== undefined) {
        update.rejected = patch.rejected
        update.rejected_by = user.toLowerCase()
      }
      if (patch.rejection_reason !== undefined) update.rejection_reason = patch.rejection_reason
      if (patch.highlighted !== undefined) update.highlighted = patch.highlighted
    }

    const updated = await eventsRepository.update(pg, id, update)
    if (!updated) throw new EventNotFoundError(id)
    return serialize(updated)
  }

  async function deleteEvent(id: string, user: string, byAdmin: boolean): Promise<void> {
    const event = await eventsRepository.findById(pg, id)
    if (!event) throw new EventNotFoundError(id)
    if (!byAdmin) await assertCanModify(event, user)

    await eventsRepository.update(pg, id, {
      deleted_at: new Date(),
      deleted_by: user.toLowerCase(),
      deleted_by_user: !byAdmin,
      deleted_by_admin: byAdmin
    })
  }

  async function updateNextStartAt(batchSize = 100): Promise<number> {
    const events = await eventsRepository.findRecurrentNeedingUpdate(pg, batchSize)
    let updated = 0
    for (const event of events) {
      if (recurrence.estimateRecurrentPastIterations(event as never) > MAX_RECURRENT_PAST_ITERATIONS) continue

      const props = recurrence.calculateRecurrentProperties({
        start_at: event.start_at,
        duration: event.duration,
        finish_at: event.finish_at,
        recurrent: event.recurrent,
        recurrent_frequency: event.recurrent_frequency as never,
        recurrent_interval: event.recurrent_interval,
        recurrent_setpos: event.recurrent_setpos,
        recurrent_monthday: event.recurrent_monthday,
        recurrent_weekday_mask: event.recurrent_weekday_mask,
        recurrent_month_mask: event.recurrent_month_mask,
        recurrent_until: event.recurrent_until,
        recurrent_count: event.recurrent_count,
        recurrent_dates: event.recurrent_dates
      })
      const next = recurrence.calculateNextRecurrentDates({
        start_at: props.start_at,
        duration: props.duration,
        recurrent_dates: props.recurrent_dates
      })
      await eventsRepository.update(pg, event.id, {
        recurrent_dates: props.recurrent_dates,
        finish_at: props.finish_at,
        next_start_at: next.next_start_at,
        next_finish_at: next.next_finish_at
      })
      updated++
    }
    return updated
  }

  return { getEvent, getEvents, getAttendingEvents, createEvent, updateEvent, deleteEvent, updateNextStartAt }
}
