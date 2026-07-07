/* eslint-disable no-console */
/**
 * Parity / smoke harness. Probes the live read surface of a discovery-server
 * deployment and (optionally) diffs it field-by-field against a second base URL —
 * e.g. the legacy places/events services during cutover.
 *
 *   ts-node test/parity/run-parity.ts --base-url https://discovery.decentraland.zone
 *   ts-node test/parity/run-parity.ts --base-url <discovery> --compare-url <legacy>
 *
 * Exit code is non-zero if any probe fails (or, in compare mode, if a checked field
 * diverges), so it can gate CI / a post-deploy step.
 */

type Probe = {
  name: string
  path: string
  /** Validate a single response body; return an error string or null when OK. */
  check: (body: any, status: number) => string | null
  /** Fields to diff in compare mode (dot paths into the JSON body). */
  compareFields?: string[]
}

const ENVELOPE = (body: any, status: number): string | null => {
  if (status !== 200) return `status ${status}`
  if (!body || body.ok !== true) return `envelope not { ok: true } (got ${JSON.stringify(body?.ok)})`
  return null
}

const PROBES: Probe[] = [
  {
    name: 'status',
    path: '/api/status',
    check: (b, s) => ENVELOPE(b, s) ?? (b?.data?.commitHash !== undefined ? null : 'missing data.commitHash')
  },
  { name: 'categories', path: '/api/categories', check: ENVELOPE, compareFields: ['data.length'] },
  { name: 'event-categories', path: '/api/events/categories', check: ENVELOPE },
  {
    name: 'places',
    path: '/api/places?limit=1',
    check: (b, s) => ENVELOPE(b, s) ?? (Array.isArray(b.data) ? null : 'data not an array'),
    compareFields: ['total']
  },
  {
    name: 'worlds',
    path: '/api/worlds?limit=1',
    check: (b, s) => ENVELOPE(b, s) ?? (Array.isArray(b.data) ? null : 'data not an array'),
    compareFields: ['total']
  },
  {
    name: 'events',
    path: '/api/events?limit=1',
    check: (b, s) => ENVELOPE(b, s) ?? (Array.isArray(b.data) ? null : 'data not an array')
  },
  {
    name: 'destinations',
    path: '/api/destinations?limit=1',
    check: (b, s) => ENVELOPE(b, s) ?? (Array.isArray(b.data) ? null : 'data not an array'),
    compareFields: ['total']
  },
  {
    name: 'v1-destinations',
    path: '/v1/destinations?limit=1',
    check: (b, s) => ENVELOPE(b, s) ?? (Array.isArray(b.data) ? null : 'data not an array')
  },
  { name: 'map', path: '/api/map', check: ENVELOPE },
  { name: 'schedules', path: '/api/schedules', check: ENVELOPE },
  { name: 'sitemap', path: '/events/sitemap.xml', check: (_b, s) => (s === 200 ? null : `status ${s}`) }
]

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function pick(obj: any, dotPath: string): unknown {
  if (dotPath === 'data.length') return Array.isArray(obj?.data) ? obj.data.length : undefined
  return dotPath.split('.').reduce((acc, key) => (acc === null || acc === undefined ? acc : acc[key]), obj)
}

async function fetchJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url)
  const text = await response.text()
  let body: any = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

async function main(): Promise<void> {
  const baseUrl = (arg('base-url') ?? process.env.PARITY_BASE_URL)?.replace(/\/$/, '')
  const compareUrl = (arg('compare-url') ?? process.env.PARITY_COMPARE_URL)?.replace(/\/$/, '')
  if (!baseUrl) throw new Error('Usage: run-parity --base-url <url> [--compare-url <url>]')

  console.log(`Parity run against ${baseUrl}${compareUrl ? ` (comparing to ${compareUrl})` : ''}\n`)
  let failures = 0

  for (const probe of PROBES) {
    try {
      const primary = await fetchJson(`${baseUrl}${probe.path}`)
      const error = probe.check(primary.body, primary.status)
      if (error) {
        failures++
        console.log(`  FAIL ${probe.name} (${probe.path}): ${error}`)
        continue
      }

      if (compareUrl && probe.compareFields?.length) {
        const other = await fetchJson(`${compareUrl}${probe.path}`)
        const diffs = probe.compareFields
          .map((field) => ({ field, a: pick(primary.body, field), b: pick(other.body, field) }))
          .filter((d) => JSON.stringify(d.a) !== JSON.stringify(d.b))
        if (diffs.length) {
          failures++
          const detail = diffs.map((d) => `${d.field}: ${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}`).join(', ')
          console.log(`  DIFF ${probe.name}: ${detail}`)
          continue
        }
      }
      console.log(`  OK   ${probe.name}`)
    } catch (error: any) {
      failures++
      console.log(`  FAIL ${probe.name} (${probe.path}): ${error?.message ?? String(error)}`)
    }
  }

  console.log(`\n${failures === 0 ? 'All probes passed.' : `${failures} probe(s) failed.`}`)
  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error('Parity run failed:', error)
  process.exit(1)
})
