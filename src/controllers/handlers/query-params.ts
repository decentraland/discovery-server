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
