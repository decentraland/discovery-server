import type { AppComponents } from '../../types'

// Must not exceed the events repository's MAX_LIMIT (100) — a larger page size is
// silently clamped there, which would drop the rest of each page from the sitemap.
const EVENTS_PER_SITEMAP = 100

export interface ISitemapComponent {
  getIndex(): Promise<string>
  getStatic(): Promise<string>
  getEvents(page: number): Promise<string>
  getSchedules(): Promise<string>
}

function xmlDoc(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${inner}`
}

function urlset(urls: Array<{ loc: string; lastmod?: string }>): string {
  const entries = urls
    .map((u) => `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
    .join('\n')
  return xmlDoc(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`)
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!
  )
}

/**
 * XML sitemaps for the events site (index + static + events + schedules). Kept
 * from the events service so event/schedule detail pages stay indexed.
 */
export async function createSitemapComponent(
  components: Pick<AppComponents, 'config' | 'eventsRepository' | 'schedulesRepository' | 'pg' | 'logs'>
): Promise<ISitemapComponent> {
  const { config, eventsRepository, schedulesRepository, pg } = components

  const baseUrl = ((await config.getString('EVENTS_BASE_URL')) ?? 'https://events.decentraland.org').replace(/\/$/, '')

  async function getIndex(): Promise<string> {
    // Enumerate one events page per EVENTS_PER_SITEMAP block so every event is
    // reachable from the index, not just the first page.
    const total = await eventsRepository.count(pg, { list: 'all' })
    const eventPages = Math.max(1, Math.ceil(total / EVENTS_PER_SITEMAP))
    const sitemaps = [
      `${baseUrl}/sitemap.static.xml`,
      ...Array.from({ length: eventPages }, (_, i) => `${baseUrl}/sitemap.events.xml?page=${i + 1}`),
      `${baseUrl}/sitemap.schedules.xml`
    ]
    const entries = sitemaps.map((loc) => `  <sitemap><loc>${escapeXml(loc)}</loc></sitemap>`).join('\n')
    return xmlDoc(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`)
  }

  async function getStatic(): Promise<string> {
    return urlset([{ loc: `${baseUrl}/` }, { loc: `${baseUrl}/submit` }])
  }

  async function getEvents(page: number): Promise<string> {
    const events = await eventsRepository.list(pg, {
      list: 'all',
      limit: EVENTS_PER_SITEMAP,
      offset: Math.max(page - 1, 0) * EVENTS_PER_SITEMAP
    })
    return urlset(events.map((e) => ({ loc: `${baseUrl}/event/${e.id}`, lastmod: e.updated_at.toISOString() })))
  }

  async function getSchedules(): Promise<string> {
    const schedules = await schedulesRepository.findActive(pg)
    return urlset(schedules.map((s) => ({ loc: `${baseUrl}/schedule/${s.id}` })))
  }

  return { getIndex, getStatic, getEvents, getSchedules }
}
