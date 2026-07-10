/**
 * Parse a repeatable, optionally comma-separated query param into a string list
 * (e.g. `?categories=a,b&categories=c` -> ['a','b','c']). Returns undefined when
 * empty so callers can treat "absent" and "explicitly empty" the same.
 */
export function multiParam(params: URLSearchParams, key: string): string[] | undefined {
  const values = params
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

/**
 * Parse a non-negative integer query param (e.g. limit/offset). Returns undefined
 * for absent, non-numeric, or negative values so the caller falls back to its
 * default instead of forwarding NaN/negative into `LIMIT`/`OFFSET` (which 500s).
 */
export function intParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : undefined
}

export type WithOptions = { withLiveEvents: boolean; withConnectedUsers: boolean; withNextEvent: boolean }

/**
 * Parse the destination decoration flags. Supports the `with=` multi-value form
 * (`with=live_events,connected_users,next_event`) plus the legacy boolean aliases
 * `with_live_events` / `with_connected_users`.
 */
export function parseWithOptions(params: URLSearchParams): WithOptions {
  const withList = multiParam(params, 'with') ?? []
  return {
    withLiveEvents: params.get('with_live_events') === 'true' || withList.includes('live_events'),
    withConnectedUsers: params.get('with_connected_users') === 'true' || withList.includes('connected_users'),
    withNextEvent: withList.includes('next_event')
  }
}
