import type { HandlerContextWithPath } from '../../types'

const XML_HEADERS = { 'content-type': 'application/xml' }

/** Legacy `GET /events/sitemap.xml` — the sitemap index. */
export async function getSitemapIndexHandler(
  context: Pick<HandlerContextWithPath<'sitemap', '/events/sitemap.xml'>, 'components'>
) {
  return { status: 200, headers: XML_HEADERS, body: await context.components.sitemap.getIndex() }
}

/** Legacy `GET /events/sitemap.static.xml`. */
export async function getStaticSitemapHandler(
  context: Pick<HandlerContextWithPath<'sitemap', '/events/sitemap.static.xml'>, 'components'>
) {
  return { status: 200, headers: XML_HEADERS, body: await context.components.sitemap.getStatic() }
}

/** Legacy `GET /events/sitemap.events.xml?page=N`. */
export async function getEventsSitemapHandler(
  context: Pick<HandlerContextWithPath<'sitemap', '/events/sitemap.events.xml'>, 'components' | 'url'>
) {
  const page = Number(context.url.searchParams.get('page')) || 1
  return { status: 200, headers: XML_HEADERS, body: await context.components.sitemap.getEvents(page) }
}

/** Legacy `GET /events/sitemap.schedules.xml`. */
export async function getSchedulesSitemapHandler(
  context: Pick<HandlerContextWithPath<'sitemap', '/events/sitemap.schedules.xml'>, 'components'>
) {
  return { status: 200, headers: XML_HEADERS, body: await context.components.sitemap.getSchedules() }
}
