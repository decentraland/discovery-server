import type { AppComponents } from '../../types'
import type { Event } from '../../types/entities'
import { ProfilePermission as Permission } from '../../types/entities'
import type { EventListFilters, CreateEventRow, UpdateEventRow } from '../../adapters/events-repository'
import { AllowedInputFrequencies, MAX_RECURRENT_PAST_ITERATIONS } from '../recurrence'
import type { RecurrentEventInput } from '../recurrence'
import { isPlaceId } from '../entity-id'
import { EventNotFoundError, EventUnauthorizedActionError, EventValidationError } from './errors'
import type { CreateEventPayload, EventWithAttendance, IEventsComponent, UpdateEventPayload } from './types'

const MAX_EVENT_DURATION_MS = 24 * 60 * 60 * 1000

/** Coerce an untrusted payload coordinate to a safe integer (defaults to 0 for junk/NaN). */
function toCoordinate(value: unknown): number {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) ? n : 0
}

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
 * `place_id`. Community ownership is validated against the communities client, and
 * the image/estate metadata is derived from Land on create.
 */
export async function createEventsComponent(
  components: Pick<
    AppComponents,
    | 'pg'
    | 'eventsRepository'
    | 'attendeesRepository'
    | 'places'
    | 'worlds'
    | 'profiles'
    | 'recurrence'
    | 'communitiesClient'
    | 'notifications'
    | 'slackNotifier'
    | 'landClient'
    | 'config'
    | 'logs'
  >
): Promise<IEventsComponent> {
  const {
    pg,
    eventsRepository,
    attendeesRepository,
    places,
    worlds,
    profiles,
    recurrence,
    communitiesClient,
    notifications,
    slackNotifier,
    landClient,
    config
  } = components

  // Events lifecycle alerts channel (legacy events SLACK_WEBHOOK); a no-op when
  // Slack or the channel is unconfigured.
  const eventsChannel = (await config.getString('SLACK_EVENTS_CHANNEL')) ?? undefined
  const eventsBaseUrl = ((await config.getString('EVENTS_BASE_URL')) ?? 'https://events.decentraland.org').replace(
    /\/$/,
    ''
  )
  // Foundation-authored events display "Decentraland Foundation" as the creator name.
  const foundationAddresses = new Set(
    ((await config.getString('FOUNDATION_ADDRESSES')) ?? '')
      .split(',')
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean)
  )
  // Delay advancing a just-finished recurrent occurrence so the per-minute notify crons can
  // fire first. Should exceed the notification interval; defaults to two minutes.
  const recurrenceUpdateGraceMs = (await config.getNumber('RECURRENCE_UPDATE_GRACE_MS')) ?? 120_000
  const alert = (text: string) => {
    void slackNotifier.notify(text, eventsChannel)
  }

  /**
   * Derive the event's image + estate metadata (legacy parity). Genesis events pull
   * the estate id/name and a default map image from the Land tile; world events fall
   * back to the static default image. A client-supplied value always wins.
   */
  async function resolvePresentation(
    payload: Pick<CreateEventPayload, 'x' | 'y' | 'image' | 'estate_id' | 'estate_name' | 'scene_name'>,
    isWorld: boolean
  ): Promise<{
    image: string | null
    estate_id: string | null
    estate_name: string | null
    scene_name: string | null
  }> {
    if (isWorld) {
      return {
        image: payload.image ?? `${eventsBaseUrl}/images/event-default.jpg`,
        estate_id: payload.estate_id ?? null,
        estate_name: payload.estate_name ?? null,
        scene_name: payload.scene_name ?? null
      }
    }
    const x = toCoordinate(payload.x)
    const y = toCoordinate(payload.y)
    // Only hit Land for the metadata the caller didn't already supply.
    const needsTile = !payload.image || !payload.estate_id || !payload.estate_name
    const tile = needsTile ? await landClient.getTile(x, y) : null
    const estate_id = payload.estate_id ?? tile?.estateId ?? null
    const estate_name = payload.estate_name ?? tile?.name ?? null
    const image = payload.image ?? (estate_id ? landClient.getEstateImage(estate_id) : landClient.getParcelImage(x, y))
    return { image, estate_id, estate_name, scene_name: payload.scene_name ?? estate_name }
  }

  // Legacy contract (model.toPublic): `place_id` carries the world id for world events;
  // foundation creators show as "Decentraland Foundation"; `contact`/`details` are omitted
  // for anyone who isn't the creator; and derived `position`/`live`/`estate_name` are added.
  function serialize(event: Event, viewer?: string): Event {
    const { contact, details, ...rest } = event
    const isOwner = viewer !== undefined && viewer.toLowerCase() === event.user
    const now = Date.now()
    const nextStart = event.next_start_at ?? event.start_at
    const live =
      !!nextStart && now >= new Date(nextStart).getTime() && now < new Date(nextStart).getTime() + event.duration
    return {
      ...rest,
      ...(isOwner ? { contact, details } : {}),
      user_name: foundationAddresses.has(event.user) ? 'Decentraland Foundation' : event.user_name,
      place_id: event.place_id ?? event.world_id,
      estate_name: event.estate_name ?? event.scene_name,
      position: [event.x, event.y],
      live
    }
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
    const position = `${toCoordinate(payload.x)},${toCoordinate(payload.y)}`
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
    // Bound the numeric recurrence inputs (legacy schema: interval 1..1000, count 0..1000).
    // A negative/non-integer interval would otherwise hang rrule; the engine also clamps.
    if (input.recurrent) {
      if (input.recurrent_interval !== undefined && input.recurrent_interval !== null) {
        const interval = Number(input.recurrent_interval)
        if (!Number.isInteger(interval) || interval < 1 || interval > 1000) {
          throw new EventValidationError('recurrent_interval must be an integer between 1 and 1000')
        }
      }
      if (input.recurrent_count !== undefined && input.recurrent_count !== null) {
        const count = Number(input.recurrent_count)
        if (!Number.isInteger(count) || count < 0 || count > 1000) {
          throw new EventValidationError('recurrent_count must be an integer between 0 and 1000')
        }
      }
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

  // Event ids are uuids; reject a non-uuid as not-found instead of letting the uuid cast 500.
  function assertEventId(id: string): void {
    if (!isPlaceId(id)) throw new EventNotFoundError(id)
  }

  async function getEvent(id: string, user?: string, isAdmin = false): Promise<EventWithAttendance> {
    assertEventId(id)
    const event = await eventsRepository.findById(pg, id)
    if (!event || !visibleToUser(event, user, isAdmin)) {
      throw new EventNotFoundError(id)
    }
    const attending = user ? await attendeesRepository.isAttending(pg, id, user) : false
    return { ...serialize(event, user), attending }
  }

  // Serialize a list for a viewer, decorating each row with the viewer's `attending` flag
  // (legacy list rows carry it). One batch query, not per-row.
  async function serializeList(events: Event[], viewer?: string): Promise<Event[]> {
    if (!viewer || !events.length) return events.map((event) => serialize(event, viewer))
    const attended = new Set(
      await attendeesRepository.listAttendedEventIds(
        pg,
        viewer,
        events.map((event) => event.id)
      )
    )
    return events.map((event) => ({ ...serialize(event, viewer), attending: attended.has(event.id) }))
  }

  async function getEvents(filters: EventListFilters): Promise<{ data: Event[]; total: number }> {
    const [data, total] = await Promise.all([eventsRepository.list(pg, filters), eventsRepository.count(pg, filters)])
    return { data: await serializeList(data, filters.viewer), total }
  }

  // List-only variant for callers that don't need the total (skips the count query).
  async function listEvents(filters: EventListFilters): Promise<Event[]> {
    const data = await eventsRepository.list(pg, filters)
    return serializeList(data, filters.viewer)
  }

  async function getAttendingEvents(user: string): Promise<Event[]> {
    const data = await eventsRepository.listAttending(pg, user)
    // Every row is one the user attends.
    return data.map((event) => ({ ...serialize(event, user), attending: true }))
  }

  async function createEvent(payload: CreateEventPayload, user: string): Promise<Event> {
    if (!payload.name) throw new EventValidationError('name is required')
    if (!payload.start_at) throw new EventValidationError('start_at is required')

    const start_at = new Date(payload.start_at)
    if (Number.isNaN(start_at.getTime())) throw new EventValidationError('start_at is invalid')

    // Number() so a non-numeric string (e.g. "abc") coerces to NaN and is rejected here,
    // not written into the integer column as a 500.
    const duration = Number(
      payload.duration ?? (payload.finish_at ? new Date(payload.finish_at).getTime() - start_at.getTime() : 0)
    )
    if (Number.isNaN(duration)) throw new EventValidationError('duration or finish_at is invalid')
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

    // When the communities API is configured, an event may only be attached to a
    // community the creator owns or moderates (legacy parity). When it is not
    // configured (dev/test), the check is skipped.
    if (payload.community_id && communitiesClient.enabled) {
      const managed = await communitiesClient.getManagedCommunities(user)
      if (!managed.some((community) => community.id === payload.community_id)) {
        throw new EventValidationError(`community "${payload.community_id}" not found or not managed by you`)
      }
    }

    const location = await resolveLocation(payload)
    const presentation = await resolvePresentation(payload, location.world)
    const row: CreateEventRow = {
      name: payload.name,
      image: presentation.image,
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
      x: toCoordinate(payload.x),
      y: toCoordinate(payload.y),
      server: payload.server ?? null,
      world: location.world,
      estate_id: presentation.estate_id,
      estate_name: presentation.estate_name,
      scene_name: presentation.scene_name,
      place_id: location.place_id,
      world_id: location.world_id,
      community_id: payload.community_id ?? null,
      url: payload.url ?? null,
      user: user.toLowerCase(),
      user_name: payload.user_name ?? null,
      contact: payload.contact ?? null,
      details: payload.details ?? null,
      // Every event is created unapproved and requires an explicit moderator approval —
      // no creator (even one who can approve events) self-approves on create (legacy parity).
      approved: false,
      rejected: false,
      approved_by: null,
      rejected_by: null,
      rejection_reason: null,
      highlighted: false,
      total_attendees: 0,
      latest_attendees: [],
      categories: payload.categories ?? [],
      schedules: payload.schedules ?? []
    }

    const created = await eventsRepository.create(pg, row)
    alert(`:tada: New event submitted: ${created.name} by ${user.toLowerCase()}`)
    return serialize(created, user)
  }

  async function assertCanModify(event: Event, user: string, isAdmin: boolean): Promise<void> {
    if (isAdmin || event.user === user.toLowerCase()) return
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

  async function updateEvent(
    id: string,
    patch: UpdateEventPayload,
    user: string,
    options: { isAdmin?: boolean; actor?: string } = {}
  ): Promise<Event> {
    assertEventId(id)
    const isAdmin = options.isAdmin ?? false
    // The moderator recorded on approve/reject: an admin may override it (automation).
    const actor = (isAdmin && options.actor?.trim()) || user.toLowerCase()
    const event = await eventsRepository.findById(pg, id)
    if (!event) throw new EventNotFoundError(id)
    await assertCanModify(event, user, isAdmin)

    const update: UpdateEventRow = {}

    // name is NOT NULL — only apply a non-empty string.
    if (typeof patch.name === 'string' && patch.name.length > 0) update.name = patch.name
    for (const key of CONTENT_KEYS) {
      if (key in patch) (update as Record<string, unknown>)[key] = patch[key]
    }

    // Timing / recurrence: recompute the materialized window from the merged rule.
    if (RECURRENCE_KEYS.some((key) => key in patch)) {
      const start_at = patch.start_at ? new Date(patch.start_at) : event.start_at
      if (Number.isNaN(start_at.getTime())) throw new EventValidationError('start_at is invalid')
      const duration = Number(
        patch.duration ?? (patch.finish_at ? new Date(patch.finish_at).getTime() - start_at.getTime() : event.duration)
      )
      if (Number.isNaN(duration)) throw new EventValidationError('duration or finish_at is invalid')
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
        // Distinguish "leave unchanged" (key absent) from "clear" (explicit null),
        // so a client can remove the recurrence end bound / count.
        recurrent_until:
          'recurrent_until' in patch
            ? patch.recurrent_until
              ? new Date(patch.recurrent_until)
              : null
            : event.recurrent_until,
        recurrent_count: 'recurrent_count' in patch ? patch.recurrent_count : event.recurrent_count
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

    // Location edit: re-resolve the target place/world and re-derive the Land metadata
    // (estate/image/scene), matching legacy updateEvent. Client-supplied image/estate still
    // win inside resolvePresentation.
    if ('x' in patch || 'y' in patch || 'server' in patch || 'world' in patch) {
      const x = toCoordinate(patch.x ?? event.x)
      const y = toCoordinate(patch.y ?? event.y)
      const server = 'server' in patch ? (patch.server ?? null) : event.server
      const requestedWorld = 'world' in patch ? patch.world : event.world
      const location = await resolveLocation({ x, y, server, world: requestedWorld })
      const presentation = await resolvePresentation(
        {
          x,
          y,
          image: patch.image,
          estate_id: patch.estate_id,
          estate_name: patch.estate_name,
          scene_name: patch.scene_name
        },
        location.world
      )
      Object.assign(update, {
        x,
        y,
        server,
        world: location.world,
        place_id: location.place_id,
        world_id: location.world_id,
        image: presentation.image,
        estate_id: presentation.estate_id,
        estate_name: presentation.estate_name,
        scene_name: presentation.scene_name
      })
    }

    // Community ownership is validated on update too (not just create): an owner can't
    // attach their event to a community they don't manage. Admins may attach any community.
    if ('community_id' in patch && patch.community_id && !isAdmin && communitiesClient.enabled) {
      const managed = await communitiesClient.getManagedCommunities(user)
      if (!managed.some((community) => community.id === patch.community_id)) {
        throw new EventValidationError(`community "${patch.community_id}" not found or not managed by you`)
      }
    }

    // Approve/reject: admins, ApproveAnyEvent, or an owner with ApproveOwnEvent.
    const isOwner = event.user === user.toLowerCase()
    const canApprove =
      isAdmin ||
      (await profiles.hasAnyPermission(user, [Permission.ApproveAnyEvent])) ||
      (isOwner && (await profiles.hasAnyPermission(user, [Permission.ApproveOwnEvent])))
    // Highlight (featured placement) is a stronger action than self-approval — an owner with
    // only ApproveOwnEvent must NOT be able to feature their own event.
    const canHighlight =
      isAdmin || (await profiles.hasAnyPermission(user, [Permission.ApproveAnyEvent, Permission.EditAnyEvent]))

    if (canApprove) {
      if (patch.approved === true && patch.rejected === true) {
        throw new EventValidationError('an event cannot be both approved and rejected')
      }
      if (patch.approved !== undefined) {
        // Approving clears any prior rejection; unapproving drops the moderator stamp.
        update.approved = patch.approved
        update.approved_by = patch.approved ? actor : null
        if (patch.approved) {
          update.rejected = false
          update.rejected_by = null
          update.rejection_reason = null
        }
      }
      if (patch.rejected !== undefined) {
        // Rejecting clears approval + featured placement; unrejecting drops the stamp/reason.
        update.rejected = patch.rejected
        update.rejected_by = patch.rejected ? actor : null
        if (patch.rejected) {
          update.approved = false
          update.approved_by = null
          update.highlighted = false
          update.rejection_reason = patch.rejection_reason ?? null
        } else {
          update.rejection_reason = null
        }
      } else if (patch.rejection_reason !== undefined) {
        update.rejection_reason = patch.rejection_reason
      }
    }
    // A reject in the same patch forces highlighted off, so only apply an explicit highlight
    // when not rejecting.
    if (canHighlight && patch.rejected !== true && patch.highlighted !== undefined) {
      update.highlighted = patch.highlighted
    }

    const updated = await eventsRepository.update(pg, id, update)
    if (!updated) throw new EventNotFoundError(id)

    // Lifecycle transitions (pre-update `event` vs the applied `update`) drive the
    // Slack alerts and the SNS notifications to the creator. Fired only on the
    // first transition into each state, matching legacy updateEvent.
    const newlyApproved = !event.approved && update.approved === true
    const newlyRejected = !event.rejected && update.rejected === true
    if (canApprove && newlyApproved) {
      alert(`:white_check_mark: Event approved: ${updated.name} by ${actor}`)
      // Fire-and-forget (the method swallows its own errors) so a slow/failed SNS
      // publish never blocks or fails the PATCH — same as the Slack alert above.
      void notifications.notifyEventApproved(updated)
    }
    if (canApprove && newlyRejected) {
      alert(
        `:x: Event rejected: ${updated.name}${update.rejection_reason ? ` (${update.rejection_reason})` : ''} by ${actor}`
      )
      void notifications.notifyEventRejected(updated, updated.rejection_reason ?? '')
    }
    // Community members are told when a community-attached event becomes public: on its
    // approval, or when an already-approved event moves to a different community. Skipped
    // when the patch is explicitly detaching the community (legacy updateEvent shouldNotify).
    const removingCommunity = 'community_id' in patch && patch.community_id === null
    const communityChanged = updated.community_id !== event.community_id
    if (updated.approved && updated.community_id && !removingCommunity && (newlyApproved || communityChanged)) {
      void notifications.notifyCommunityEventPublished(updated)
    }
    return serialize(updated, user)
  }

  async function deleteEvent(
    id: string,
    user: string,
    byAdmin: boolean,
    actor?: string,
    reason?: string
  ): Promise<void> {
    assertEventId(id)
    const event = await eventsRepository.findById(pg, id)
    if (!event) throw new EventNotFoundError(id)
    if (!byAdmin) await assertCanModify(event, user, false)
    // Soft-delete is terminal: a re-delete is an idempotent no-op so it can't overwrite the
    // original deleter/flags (e.g. an admin re-deleting an owner-deleted event).
    if (event.deleted_at) return

    // Admins may record an override actor as the deleter (automation).
    const deletedBy = (byAdmin && actor?.trim()) || user.toLowerCase()
    // A moderator/admin removing someone else's event is a "deleted by moderator" action:
    // it records a reason and notifies the creator. An owner deleting their own event does neither.
    const isOwnerDelete = !byAdmin && event.user === user.toLowerCase()
    const trimmedReason = reason?.trim() || undefined
    await eventsRepository.update(pg, id, {
      deleted_at: new Date(),
      deleted_by: deletedBy,
      deleted_by_user: !byAdmin,
      deleted_by_admin: byAdmin,
      deleted_reason: isOwnerDelete ? null : (trimmedReason ?? null)
    })
    if (!isOwnerDelete) {
      // Fire-and-forget (the method swallows its own errors); mirrors the approve/reject path.
      void notifications.notifyEventDeleted(event, trimmedReason)
    }
  }

  async function updateNextStartAt(batchSize = 100): Promise<number> {
    const events = await eventsRepository.findRecurrentNeedingUpdate(pg, batchSize, recurrenceUpdateGraceMs)
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

  return {
    getEvent,
    getEvents,
    listEvents,
    getAttendingEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    updateNextStartAt
  }
}
