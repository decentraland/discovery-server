import type { AppComponents } from '../../types'
import type { Event } from '../../types/entities'
import { ProfilePermission as Permission } from '../../types/entities'
import type { EventListFilters, CreateEventRow } from '../../adapters/events-repository'
import { MAX_RECURRENT_PAST_ITERATIONS } from '../recurrence'
import { EventNotFoundError, EventUnauthorizedActionError, EventValidationError } from './errors'
import type { CreateEventPayload, EventWithAttendance, IEventsComponent, UpdateEventPayload } from './types'

/**
 * Event orchestration. Recurrence is materialized in-process via the recurrence
 * engine; the target place/world is resolved in-process via the places/worlds
 * logic (replacing the legacy HTTP Places-API client, null-tolerant on a miss);
 * approval is gated by the creator's profile permissions. Community validation
 * and Catalyst profile enrichment are layered in with those adapters.
 */
export async function createEventsComponent(
  components: Pick<
    AppComponents,
    'pg' | 'eventsRepository' | 'attendeesRepository' | 'places' | 'worlds' | 'profiles' | 'recurrence' | 'logs'
  >
): Promise<IEventsComponent> {
  const { pg, eventsRepository, attendeesRepository, places, worlds, profiles, recurrence } = components

  async function resolveLocation(
    payload: Pick<CreateEventPayload, 'x' | 'y' | 'server' | 'world'>
  ): Promise<{ place_id: string | null; world_id: string | null; world: boolean }> {
    const isWorld = payload.world === true || (!!payload.server && payload.world !== false && payload.x === undefined)
    if (isWorld && payload.server) {
      const { data } = await worlds.getWorlds({ names: [payload.server], limit: 1 })
      return { place_id: null, world_id: data[0]?.id ?? null, world: true }
    }
    const position = `${payload.x ?? 0},${payload.y ?? 0}`
    const { data } = await places.getPlaces({ positions: [position], limit: 1 })
    return { place_id: data[0]?.id ?? null, world_id: null, world: false }
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
    return { ...event, attending }
  }

  async function getEvents(filters: EventListFilters): Promise<{ data: Event[]; total: number }> {
    const [data, total] = await Promise.all([eventsRepository.list(pg, filters), eventsRepository.count(pg, filters)])
    return { data, total }
  }

  async function getAttendingEvents(user: string): Promise<Event[]> {
    return eventsRepository.listAttending(pg, user)
  }

  async function createEvent(payload: CreateEventPayload, user: string): Promise<Event> {
    if (!payload.name) throw new EventValidationError('name is required')
    if (!payload.start_at) throw new EventValidationError('start_at is required')

    const start_at = new Date(payload.start_at)
    if (Number.isNaN(start_at.getTime())) throw new EventValidationError('start_at is invalid')

    const duration =
      payload.duration ?? (payload.finish_at ? new Date(payload.finish_at).getTime() - start_at.getTime() : 0)
    if (duration < 0) throw new EventValidationError('duration must be non-negative')

    const recurrentInput = {
      recurrent: payload.recurrent ?? false,
      recurrent_frequency: payload.recurrent_frequency ?? null,
      recurrent_interval: payload.recurrent_interval ?? 1,
      recurrent_count: payload.recurrent_count ?? null,
      recurrent_until: payload.recurrent_until ? new Date(payload.recurrent_until) : null,
      start_at
    }
    if (recurrence.estimateRecurrentPastIterations(recurrentInput as any) > MAX_RECURRENT_PAST_ITERATIONS) {
      throw new EventValidationError('recurrence rule expands to too many past iterations')
    }

    const recurrentProps = recurrence.calculateRecurrentProperties({
      start_at,
      duration,
      finish_at: new Date(start_at.getTime() + duration),
      recurrent: payload.recurrent ?? false,
      recurrent_frequency: payload.recurrent_frequency ?? null,
      recurrent_interval: payload.recurrent_interval ?? 1,
      recurrent_setpos: payload.recurrent_setpos ?? null,
      recurrent_monthday: payload.recurrent_monthday ?? null,
      recurrent_weekday_mask: payload.recurrent_weekday_mask ?? 0,
      recurrent_month_mask: payload.recurrent_month_mask ?? 0,
      recurrent_until: payload.recurrent_until ? new Date(payload.recurrent_until) : null,
      recurrent_count: payload.recurrent_count ?? null,
      recurrent_dates: []
    })
    const next = recurrence.calculateNextRecurrentDates({
      start_at: recurrentProps.start_at,
      duration: recurrentProps.duration,
      recurrent_dates: recurrentProps.recurrent_dates
    })

    const location = await resolveLocation(payload)
    const canApprove = await profiles.hasAnyPermission(user, [Permission.ApproveOwnEvent, Permission.ApproveAnyEvent])

    const row: CreateEventRow = {
      name: payload.name,
      image: payload.image ?? null,
      image_vertical: payload.image_vertical ?? null,
      description: payload.description ?? null,
      start_at: recurrentProps.start_at,
      finish_at: recurrentProps.finish_at,
      duration: recurrentProps.duration,
      all_day: payload.all_day ?? false,
      next_start_at: next.next_start_at,
      next_finish_at: next.next_finish_at,
      recurrent: recurrentProps.recurrent,
      recurrent_frequency: recurrentProps.recurrent_frequency,
      recurrent_setpos: recurrentProps.recurrent_setpos,
      recurrent_monthday: recurrentProps.recurrent_monthday,
      recurrent_weekday_mask: recurrentProps.recurrent_weekday_mask,
      recurrent_month_mask: recurrentProps.recurrent_month_mask,
      recurrent_interval: recurrentProps.recurrent_interval,
      recurrent_count: recurrentProps.recurrent_count,
      recurrent_until: recurrentProps.recurrent_until,
      recurrent_dates: recurrentProps.recurrent_dates,
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

    return eventsRepository.create(pg, row)
  }

  async function assertCanModify(event: Event, user: string): Promise<void> {
    if (event.user === user.toLowerCase()) return
    const allowed = await profiles.hasAnyPermission(user, [Permission.EditAnyEvent, Permission.ApproveAnyEvent])
    if (!allowed) throw new EventUnauthorizedActionError()
  }

  async function updateEvent(id: string, patch: UpdateEventPayload, user: string): Promise<Event> {
    const event = await eventsRepository.findById(pg, id)
    if (!event) throw new EventNotFoundError(id)
    await assertCanModify(event, user)

    const update: Record<string, unknown> = {}
    const assignable: Array<keyof UpdateEventPayload> = [
      'name',
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
    for (const key of assignable) {
      if (key in patch) update[key] = patch[key]
    }
    const updated = await eventsRepository.update(pg, id, update)
    if (!updated) throw new EventNotFoundError(id)
    return updated
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

  return { getEvent, getEvents, getAttendingEvents, createEvent, updateEvent, deleteEvent }
}
