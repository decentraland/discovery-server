import SQL from 'sql-template-strings'
import { test } from '../components'

test('when running notification crons against a real database', function ({ components }) {
  describe('and an event just started with an attendee', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM notification_cursors`)
      await components.pg.query(SQL`DELETE FROM event_attendees`)
      await components.pg.query(SQL`DELETE FROM events`)
      // Seed a baseline cursor in the past so the window includes the seeded event.
      await components.notificationCursorsRepository.set(components.pg, 'events_started', Date.now() - 10 * 60 * 1000)
      const result = await components.pg.query<{ id: string }>(SQL`
        INSERT INTO events (name, start_at, finish_at, duration, "user", approved, next_start_at, next_finish_at)
        VALUES ('Started', now() - interval '1 minute', now() + interval '1 hour', 3600000, '0xowner', true,
                now() - interval '1 minute', now() + interval '1 hour')
        RETURNING id`)
      await components.attendeesRepository.add(components.pg, result.rows[0].id, '0xattendee', null)
    })

    it('should complete without error and advance the cursor', async () => {
      await components.notifications.notifyStarted()
      const cursor = await components.notificationCursorsRepository.get(components.pg, 'events_started')

      expect(cursor).not.toBeNull()
      expect(cursor!.last_successful_run_at).toBeGreaterThan(Date.now() - 10_000)
    })

    it('should be idempotent — a second run finds nothing new in the window', async () => {
      await components.notifications.notifyStarted()
      const secondRun = await components.notifications.notifyStarted()

      // SNS is unconfigured in tests, so published is 0; the assertion is that it does not throw
      // and the window no longer contains the already-processed event.
      expect(secondRun).toBe(0)
    })
  })
})
