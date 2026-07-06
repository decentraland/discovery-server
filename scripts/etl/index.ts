/* eslint-disable no-console */
import { Pool } from 'pg'
import {
  migrateContentRatings,
  migrateEventAttendees,
  migrateEvents,
  migrateNotificationCursors,
  migratePlaceCategories,
  migratePlaces,
  migrateProfileSettings,
  migrateSchedules,
  migrateUserFavorites,
  migrateUserLikes,
  migrateWorlds,
  recomputeEntityAggregates,
  truncateTarget,
  verify,
  type EtlOptions,
  type EtlPools,
  type TableReport
} from './migrate'

/**
 * ETL entry point. Reads read-only connection strings for the two legacy prod
 * DBs and the target from the environment, runs the migration in FK-safe order,
 * recomputes denormalized aggregates, and prints a per-table + verification report.
 *
 *   PLACES_SOURCE_DB_URL  legacy places Postgres (read-only)
 *   EVENTS_SOURCE_DB_URL  legacy events Postgres (read-only)
 *   PG_COMPONENT_PSQL_CONNECTION_STRING  target (already migrated to the baseline schema)
 *
 * Flags:
 *   --dry-run          read + count, no writes
 *   --fresh            TRUNCATE the ETL-owned target tables before loading
 *   --since <ISO>      only re-load worlds/places/events changed after the timestamp
 *                      (delta top-up; child tables are always re-loaded idempotently)
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const sinceIndex = argv.indexOf('--since')
  const options: EtlOptions = {
    dryRun: argv.includes('--dry-run'),
    since: sinceIndex >= 0 ? argv[sinceIndex + 1] : undefined
  }
  const fresh = argv.includes('--fresh')

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

  console.log(
    `Starting ETL${options.dryRun ? ' (dry-run)' : ''}${fresh ? ' (fresh)' : ''}${options.since ? ` (since ${options.since})` : ''}...`
  )
  const reports: TableReport[] = []
  try {
    if (fresh && !options.dryRun) {
      console.log('Truncating target tables...')
      await truncateTarget(pools)
    }

    // FK-safe order: worlds -> places -> (pivot) -> schedules -> events -> attendees,
    // then the interaction/audit/profile/cursor loaders, then the aggregate recompute.
    reports.push(await migrateWorlds(pools, options))
    reports.push(await migratePlaces(pools, options))
    reports.push(await migratePlaceCategories(pools, options))
    reports.push(await migrateSchedules(pools, options))
    reports.push(await migrateEvents(pools, options))
    reports.push(await migrateEventAttendees(pools, options))
    reports.push(await migrateUserLikes(pools, options))
    reports.push(await migrateUserFavorites(pools, options))
    reports.push(await migrateContentRatings(pools, options))
    reports.push(await migrateProfileSettings(pools, options))
    reports.push(await migrateNotificationCursors(pools, options))

    if (!options.dryRun) {
      console.log('Recomputing places/worlds like aggregates...')
      await recomputeEntityAggregates(pools, options)
    }

    console.log('\nETL report:')
    for (const r of reports) {
      console.log(`  ${r.table}: source=${r.source} loaded=${r.loaded}`)
    }

    if (!options.dryRun) {
      console.log('\nVerification:')
      const checks = await verify(pools)
      for (const c of checks) {
        console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.check}: ${c.detail}`)
      }
      if (checks.some((c) => !c.ok)) {
        throw new Error('ETL verification failed — see report above')
      }
    }
  } finally {
    await Promise.all([pools.placesSource.end(), pools.eventsSource.end(), pools.target.end()])
  }

  console.log('Done.')
}

main().catch((error) => {
  console.error('ETL failed:', error)
  process.exit(1)
})
