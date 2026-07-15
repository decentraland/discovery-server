import type { HandlerContextWithPath } from '../../types'

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' }

/** Legacy `GET /places/place/` — OG link-preview HTML for a place (?id or ?position). */
export async function getPlaceSocialHandler(
  context: Pick<HandlerContextWithPath<'social', '/places/place/'>, 'components' | 'url'>
) {
  const params = context.url.searchParams
  const body = await context.components.social.getPlaceMetaHtml({
    id: params.get('id') ?? undefined,
    position: params.get('position') ?? undefined
  })
  return { status: 200, headers: HTML_HEADERS, body }
}

/** Legacy `GET /places/world/` — OG link-preview HTML for a world (?id or ?name). */
export async function getWorldSocialHandler(
  context: Pick<HandlerContextWithPath<'social', '/places/world/'>, 'components' | 'url'>
) {
  const params = context.url.searchParams
  const body = await context.components.social.getWorldMetaHtml({
    id: params.get('id') ?? undefined,
    name: params.get('name') ?? undefined
  })
  return { status: 200, headers: HTML_HEADERS, body }
}
