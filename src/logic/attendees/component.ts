import type { AppComponents } from '../../types'
import type { EventAttendee } from '../../types/entities'
import { sanitizePlainText } from '../content-sanitization'
import type { IAttendeesComponent } from './types'

/**
 * Attendance orchestration. Each mutation runs in a transaction so the attendee
 * row and the denormalized counters on the event (total_attendees /
 * latest_attendees) always move together.
 */
export async function createAttendeesComponent(
  components: Pick<AppComponents, 'pg' | 'attendeesRepository' | 'logs'>
): Promise<IAttendeesComponent> {
  const { pg, attendeesRepository } = components

  async function attend(eventId: string, user: string, userName: string | null): Promise<void> {
    await pg.withTransaction(async (tx) => {
      // Lock the event first so a concurrent attend/unattend can't recompute the
      // counters from a stale snapshot and lose this write.
      await attendeesRepository.lockEvent(tx, eventId)
      await attendeesRepository.add(tx, eventId, user, userName)
      await attendeesRepository.recomputeCounters(tx, eventId)
    })
  }

  async function unattend(eventId: string, user: string): Promise<void> {
    await pg.withTransaction(async (tx) => {
      await attendeesRepository.lockEvent(tx, eventId)
      await attendeesRepository.remove(tx, eventId, user)
      await attendeesRepository.recomputeCounters(tx, eventId)
    })
  }

  async function getAttendees(eventId: string): Promise<EventAttendee[]> {
    // user_name is an attendee-authored profile display name; reduce it to plain text on read so
    // a `<link>` in a display name can't reach the TMP client via the attendee list.
    const attendees = await attendeesRepository.listByEvent(pg, eventId)
    return attendees.map((attendee) => ({ ...attendee, user_name: sanitizePlainText(attendee.user_name) }))
  }

  return { attend, unattend, getAttendees }
}
