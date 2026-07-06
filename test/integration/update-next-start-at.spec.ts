import SQL from 'sql-template-strings'
import { test } from '../components'

const HOUR_MS = 60 * 60 * 1000

test('when refreshing recurrent event windows', function ({ components }) {
  describe('and a recurrent event has a stale next occurrence but future dates remain', () => {
    let eventId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      const created = await components.events.createEvent(
        {
          name: 'Daily standup',
          start_at: new Date(Date.now() - HOUR_MS).toISOString(),
          duration: HOUR_MS,
          x: 0,
          y: 0,
          recurrent: true,
          recurrent_frequency: 'DAILY' as never,
          recurrent_count: 30
        },
        '0xowner'
      )
      eventId = created.id
      // Force the tracked next window into the past so the refresh job picks it up.
      await components.pg.query(SQL`UPDATE events SET next_finish_at = now() - interval '1 day' WHERE id = ${eventId}`)
    })

    it('should update at least one event', async () => {
      const updated = await components.events.updateNextStartAt()

      expect(updated).toBeGreaterThanOrEqual(1)
    })

    it('should advance next_start_at to a future occurrence', async () => {
      await components.events.updateNextStartAt()
      const event = await components.eventsRepository.findById(components.pg, eventId)

      expect(event!.next_start_at!.getTime()).toBeGreaterThan(Date.now())
    })
  })

  describe('and no recurrent events need updating', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
    })

    it('should update nothing', async () => {
      const updated = await components.events.updateNextStartAt()

      expect(updated).toBe(0)
    })
  })
})
