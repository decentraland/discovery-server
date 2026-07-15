import SQL from 'sql-template-strings'
import { test } from '../components'

test('when serving sitemaps', function ({ components }) {
  describe('and requesting the sitemap index', () => {
    it('should return an XML sitemapindex referencing the sub-sitemaps', async () => {
      const response = await components.localFetch.fetch('/events/sitemap.xml')
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/xml')
      expect(body).toContain('<sitemapindex')
      expect(body).toContain('sitemap.events.xml')
    })
  })

  describe('and approved events exist', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM events`)
      await components.pg.query(SQL`
        INSERT INTO events (name, start_at, finish_at, duration, "user", approved, next_start_at, next_finish_at)
        VALUES ('Indexed', now(), now() + interval '1 hour', 3600000, '0xowner', true, now(), now() + interval '1 hour')`)
    })

    it('should list the approved event url in the events sitemap', async () => {
      const response = await components.localFetch.fetch('/events/sitemap.events.xml')
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(body).toContain('<urlset')
      expect(body).toContain('/event/')
    })
  })
})
