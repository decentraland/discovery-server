import type { EventAttendee } from '../../types/entities'

export interface IAttendeesComponent {
  attend(eventId: string, user: string, userName: string | null): Promise<void>
  unattend(eventId: string, user: string): Promise<void>
  getAttendees(eventId: string): Promise<EventAttendee[]>
}
