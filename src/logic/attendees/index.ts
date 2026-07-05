import type { AppComponents } from '../../types'
import type { EventAttendee } from '../../types/entities'

export interface IAttendeesComponent {
  attend(eventId: string, user: string, userName: string | null): Promise<void>
  unattend(eventId: string, user: string): Promise<void>
  getAttendees(eventId: string): Promise<EventAttendee[]>
}

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
      await attendeesRepository.add(tx, eventId, user, userName)
      await attendeesRepository.recomputeCounters(tx, eventId)
    })
  }

  async function unattend(eventId: string, user: string): Promise<void> {
    await pg.withTransaction(async (tx) => {
      await attendeesRepository.remove(tx, eventId, user)
      await attendeesRepository.recomputeCounters(tx, eventId)
    })
  }

  async function getAttendees(eventId: string): Promise<EventAttendee[]> {
    return attendeesRepository.listByEvent(pg, eventId)
  }

  return { attend, unattend, getAttendees }
}
