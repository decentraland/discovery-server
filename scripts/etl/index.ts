/* eslint-disable no-console */
import { Pool } from 'pg'
import { migrateEvents, migratePlaces, migrateWorlds, type EtlOptions, type EtlPools, type TableReport } from './migrate'

/**
 * ETL entry point. Reads read-only connection strings for the two legacy prod
 * DBs and the target from the environment, runs the migration in FK-safe order
 * (worlds -> places -> events), and prints a per-table report.
 *
 *   PLACES_SOURCE_DB_URL  legacy places Postgres (read-only)
 *   EVENTS_SOURCE_DB_URL  legacy events Postgres (read-only)
 *   PG_COMPONENT_PSQL_CONNECTION_STRING  target (already migrated to the baseline schema)
 *
 * Flags: --dry-run (read + count, no writes).
 */
async function main(): Promise<void> {
  const options: EtlOptions = { dryRun: process.argv.includes('--dry-run') }

  const placesUrl = process.env.PLACES_SOURCE_DB_URL
  const eventsUrl = process.env.EVENTS_SOURCE_DB_URL
  const targetUrl = process.env.PG_COMPONENT_PSQL_CONNECTION_STRING
  if (!placesUrl || !eventsUrl || !targetUrl) {
    throw new Error('PLACES_SOURCE_DB_URL, EVENTS_SOURCE_DB_URL and PG_COMPONENT_PSQL_CONNECTION_STRING are required')
  }

  const pools: EtlPools = {
    placesSource: new Pool({ connectionString: placesUrl }),
    eventsSource: new Pool({ connectionString: eventsUrl }),
    target: new Pool({ connectionString: targetUrl })
  }

  console.log(`Starting ETL${options.dryRun ? ' (dry-run)' : ''}...`)
  const reports: TableReport[] = []
  try {
    // FK-safe order: worlds before places (places.world_id -> worlds), then events (place_id/world_id).
    reports.push(await migrateWorlds(pools, options))
    reports.push(await migratePlaces(pools, options))
    reports.push(await migrateEvents(pools, options))
  } finally {
    await Promise.all([pools.placesSource.end(), pools.eventsSource.end(), pools.target.end()])
  }

  console.log('\nETL report:')
  for (const r of reports) {
    console.log(`  ${r.table}: source=${r.source} loaded=${r.loaded}`)
  }
  console.log('Done.')
}

main().catch((error) => {
  console.error('ETL failed:', error)
  process.exit(1)
})
