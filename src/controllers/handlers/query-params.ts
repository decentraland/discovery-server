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
