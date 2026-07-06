import type { AppComponents } from '../../types'

export interface ISocialComponent {
  /** OG/Twitter meta HTML for a place, by id or by `x,y` position. */
  getPlaceMetaHtml(params: { id?: string; position?: string }): Promise<string>
  /** OG/Twitter meta HTML for a world, by id or name. */
  getWorldMetaHtml(params: { id?: string; name?: string }): Promise<string>
}

function escapeHtml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' })[c]!)
}

function metaHtml(meta: { title: string; description: string; image: string; url: string }): string {
  const t = escapeHtml(meta.title)
  const d = escapeHtml(meta.description)
  const i = escapeHtml(meta.image)
  const u = escapeHtml(meta.url)
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<title>${t}</title>
<meta property="og:title" content="${t}"/>
<meta property="og:description" content="${d}"/>
<meta property="og:image" content="${i}"/>
<meta property="og:url" content="${u}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${t}"/>
<meta name="twitter:description" content="${d}"/>
<meta name="twitter:image" content="${i}"/>
</head><body></body></html>`
}

/**
 * Link-preview (Open Graph) HTML for place/world share pages. Reads the entity
 * in-process via the places/worlds logic and renders meta tags; falls back to a
 * generic Decentraland card when the entity is missing (200, never a broken
 * unfurl).
 */
export async function createSocialComponent(
  components: Pick<AppComponents, 'places' | 'worlds' | 'config' | 'logs'>
): Promise<ISocialComponent> {
  const { places, worlds, config } = components

  const placesBaseUrl = ((await config.getString('PLACES_BASE_URL')) ?? 'https://places.decentraland.org').replace(
    /\/$/,
    ''
  )
  const fallbackImage = `${placesBaseUrl}/og-image.png`

  async function resolvePlace(params: { id?: string; position?: string }) {
    // Never let a lookup error break the unfurl — fall through to the generic card.
    try {
      if (params.id) return await places.getPlace(params.id)
      if (params.position) return (await places.getPlaces({ positions: [params.position], limit: 1 })).data[0] ?? null
      return null
    } catch {
      return null
    }
  }

  async function getPlaceMetaHtml(params: { id?: string; position?: string }): Promise<string> {
    const place = await resolvePlace(params)
    if (!place) {
      return metaHtml({
        title: 'Decentraland',
        description: 'Explore Decentraland',
        image: fallbackImage,
        url: placesBaseUrl
      })
    }
    return metaHtml({
      title: place.title ?? 'Decentraland Place',
      description: place.description ?? 'Explore this place in Decentraland',
      image: place.image ?? fallbackImage,
      url: `${placesBaseUrl}/place/?id=${place.id}`
    })
  }

  async function getWorldMetaHtml(params: { id?: string; name?: string }): Promise<string> {
    const key = params.id ?? params.name
    const world = key ? await worlds.getWorld(key).catch(() => null) : null
    if (!world) {
      return metaHtml({
        title: 'Decentraland Worlds',
        description: 'Explore Decentraland Worlds',
        image: fallbackImage,
        url: placesBaseUrl
      })
    }
    return metaHtml({
      title: world.title ?? world.world_name,
      description: world.description ?? 'Explore this world in Decentraland',
      image: world.image ?? fallbackImage,
      url: `${placesBaseUrl}/world/?id=${world.id}`
    })
  }

  return { getPlaceMetaHtml, getWorldMetaHtml }
}
