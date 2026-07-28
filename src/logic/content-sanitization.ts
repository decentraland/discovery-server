// Shared sanitizers for creator/user-authored text and image URLs, applied at the
// ingestion (place/world) and serialization (event) boundaries.
//
// The Unity client renders place/world/event descriptions as TextMeshPro rich text
// (no HTML, no Markdown) and turns `<link="target">text</link>` into a clickable link
// that reaches an unrestricted `Application.OpenURL(target)` on the viewer's machine —
// so a `decentraland://` / `smb://` / `file://` / `javascript:` target fires a local
// handler, and an http(s) URL aimed at an internal/loopback/metadata host points the
// viewer's browser at their own network.

// Matches an HTML-/TMP-style markup tag: `<` followed by an optional closing slash and a
// tag name that begins with a letter, up to the next `>` (`<link="…">`, `</link>`, `<b>`,
// `<color=#fff>`). A bare `<` in prose ("5 < 10") is left untouched because it isn't
// immediately followed by a letter or slash, so plain text and Markdown survive intact.
// The body is `[^>]*` (not `[^<>]*`) so a malformed opener that embeds a nested tag —
// `<link="javascript:…"<b>` — is captured as one span up to the first `>` and rejected whole,
// rather than being left as an unmatched `<link…` fragment that a later strip could
// re-assemble into a live unsafe link (fail-closed).
const MARKUP_TAG_REGEX = /<\/?[a-zA-Z][^>]*>/g

// A TMP `<link=…>` / `<link="…">` opening tag (capturing the optionally quoted target) and
// its matching `</link>` closing tag. The opening pattern only matches a *clean* single-value
// link tag — any extra attributes or stray quotes fall through to the strip branch, so
// ambiguous tags are never preserved (fail-safe).
const LINK_OPEN_TAG_REGEX = /^<link\s*=\s*"?([^"<>]*)"?\s*>$/i
const LINK_CLOSE_TAG_REGEX = /^<\/link\s*>$/i

// A `<`/`</` that begins a `link` tag with NO closing `>` before the next `<` or end of string —
// an unclosed opener the tag strip leaves untouched (a real TMP link needs its `>`). Its `<` is
// dropped so it can never be read as a link; a kept safe link / closer keeps its `>` and fails
// the negative lookahead, so it is left intact.
const UNCLOSED_LINK_LT_REGEX = /<(?=\/?link\b)(?![^<>]*>)/gi

// Reserved / internal-use DNS suffixes that never belong to a public host.
const INTERNAL_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.home.arpa'
]

// Loopback / private / link-local (incl. the 169.254.169.254 cloud-metadata endpoint) /
// carrier-grade-NAT / internal-name hosts a link must never point at. `hostname` is already
// lowercased + WHATWG-normalized by `new URL`, so obfuscated IPv4 forms (decimal/hex/octal/
// short) arrive as canonical dotted quads and can't slip past.
function isInternalLinkHost(hostname: string): boolean {
  const unbracketed = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  // A trailing dot is the fully-qualified form of the same host (`localhost.`, `router.local.`)
  // and resolves identically, so normalize it away before the single-label / suffix checks —
  // otherwise `localhost.` reads as a dotted, non-reserved name and slips through.
  const host = unbracketed.replace(/\.+$/, '')

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    return (
      a === 0 || // "this host"
      a === 127 || // loopback
      a === 10 || // private
      (a === 169 && b === 254) || // link-local incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    )
  }

  if (host.includes(':')) {
    return (
      host === '::1' || // loopback
      host === '::' || // unspecified
      /^fe[89ab]/.test(host) || // link-local fe80::/10
      /^f[cd]/.test(host) || // unique-local fc00::/7
      host.startsWith('::ffff:') // IPv4-mapped
    )
  }

  // DNS name: a public host is a dotted FQDN under a real TLD, so a single-label name
  // (`router`, `nas`, `localhost`) or a reserved internal-use suffix is treated as internal.
  // DNS is not resolved here — best-effort fail-closed for local-looking names.
  if (!host.includes('.')) return true
  return INTERNAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

// Only http(s) links to a public host are safe to hand to the client. A non-web scheme fires a
// local handler on the viewer's machine, and an http(s) URL aimed at an internal host points the
// viewer's browser at their own network — both are stripped.
function isSafeLinkTarget(target: string): boolean {
  const trimmed = target.trim()
  // A real URL never carries raw whitespace, so an inner space means the tag had extra junk
  // after the target (e.g. `<link=https://a onclick=x>`); treat it as ambiguous and strip it.
  if (/\s/.test(trimmed)) return false

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return false
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  return !isInternalLinkHost(url.hostname.toLowerCase())
}

// Upper bound on sanitization passes (see sanitizeDescription). Real content stabilizes in one
// pass; a reassembly attack needs two. Beyond this we fail closed instead of looping.
const MAX_SANITIZE_PASSES = 5

// One left-to-right strip pass over `text`. A stack records whether the `<link>` currently being
// closed was kept, to decide its `</link>`.
function stripMarkupOnce(text: string): string {
  const openLinkKept: boolean[] = []
  return text.replace(MARKUP_TAG_REGEX, (tag) => {
    if (LINK_CLOSE_TAG_REGEX.test(tag)) {
      // Drop orphan closers; otherwise mirror the matching opener.
      return openLinkKept.length > 0 && openLinkKept.pop() ? tag : ''
    }
    const openMatch = tag.match(LINK_OPEN_TAG_REGEX)
    if (openMatch) {
      const keep = isSafeLinkTarget(openMatch[1])
      openLinkKept.push(keep)
      return keep ? tag : ''
    }
    return ''
  })
}

// One sanitization pass: strip complete markup tags, then drop the `<` of any unclosed `<link`
// left behind so removed markup can never leave a dangling link opener.
function stripPass(text: string): string {
  return stripMarkupOnce(text).replace(UNCLOSED_LINK_LT_REGEX, '')
}

/**
 * Neutralize unsafe markup in a creator/user-authored description while preserving safe
 * hyperlinks. `<link>` tags pointing at public http(s) URLs — the legitimate use case — are
 * kept; links to any other scheme (or an internal/loopback/metadata host) and every other
 * markup tag are stripped, dropping both sides of a stripped link so no orphan `</link>`
 * remains. Stripping rather than HTML-escaping keeps the text clean, since TMP does not decode
 * entities like `&lt;`. Returns null for empty (or fully-stripped) input to match the
 * `string | null` column shape.
 *
 * Stripping a tag can fuse residual text into a NEW tag the single pass never revisits (e.g.
 * `<<b>link="javascript:…">` → strip `<b>` → live `<link…>`), so we re-run `stripPass` to a
 * fixed point. Each changing pass strictly shortens the string, so it converges — at the stable
 * point the only complete tags left are safe links that were kept, and any unclosed `<link`
 * has had its `<` dropped by `stripPass`. If a pathological input has not stabilized within
 * MAX_SANITIZE_PASSES we fail closed by removing every angle bracket.
 *
 * @param description - The raw creator/user-authored description (nullable).
 * @returns The description with unsafe markup removed, or null when nothing is left.
 */
export function sanitizeDescription(description: string | null | undefined): string | null {
  if (!description) return null

  let current = description
  for (let pass = 0; pass < MAX_SANITIZE_PASSES; pass++) {
    const next = stripPass(current)
    if (next === current) return current || null
    current = next
  }
  return current.replace(/[<>]/g, '') || null
}

/**
 * Validate that a creator/user-supplied image URL is a safe absolute http(s) URL to a public
 * host and return it normalized, or null otherwise. Scene `navmapThumbnail` / world
 * `thumbnailUrl` / event image values are attacker-controlled and were stored verbatim; parsing
 * through `URL` rejects non-URL payloads and percent-encodes any HTML-breakout characters
 * (`"`, `<`, `>`), so the stored value can never carry raw markup into API responses / social
 * HTML. The same public-host rule the TMP links use is applied, so an image pointed at an
 * internal / loopback / cloud-metadata host (which a client/crawler/downstream fetcher would
 * otherwise be aimed at) is rejected too.
 *
 * @param value - The raw image/thumbnail URL (nullable).
 * @returns The normalized http(s) URL, or null when it is not a safe absolute http(s) public URL.
 */
export function sanitizeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (isInternalLinkHost(url.hostname.toLowerCase())) return null
    return url.toString()
  } catch {
    return null
  }
}
