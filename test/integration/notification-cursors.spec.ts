import SQL from 'sql-template-strings'
import { test } from '../components'

test('when tracking notification cursors', function ({ components }) {
  describe('and a cursor has been set for a notification type', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM notification_cursors`)
      await components.notificationCursorsRepository.set(components.pg, 'events_starts_soon', 1_700_000_000_000)
    })

    it('should read back the stored timestamp', async () => {
      const cursor = await components.notificationCursorsRepository.get(components.pg, 'events_starts_soon')

      expect(cursor).toEqual({ id: 'events_starts_soon', last_successful_run_at: 1_700_000_000_000 })
    })

    it('should advance the timestamp on a subsequent set', async () => {
      await components.notificationCursorsRepository.set(components.pg, 'events_starts_soon', 1_700_000_500_000)
      const cursor = await components.notificationCursorsRepository.get(components.pg, 'events_starts_soon')

      expect(cursor!.last_successful_run_at).toBe(1_700_000_500_000)
    })
  })

  describe('and no cursor exists for a notification type', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM notification_cursors`)
    })

    it('should return null', async () => {
      const cursor = await components.notificationCursorsRepository.get(components.pg, 'never_run')

      expect(cursor).toBeNull()
    })
  })
})
