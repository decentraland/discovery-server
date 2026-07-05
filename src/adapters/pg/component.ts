import { resolve } from 'path'
import { createPgComponent as createBasePgComponent } from '@dcl/pg-component'
import type { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import type { SQLStatement } from 'sql-template-strings'
import type { IPgComponent } from './types'

/**
 * Postgres pool + migration runner. Migrations in `src/migrations` run on
 * component START via `@dcl/pg-component` (node-pg-migrate v7 under the hood);
 * the pool drains on STOP. Connection string comes from
 * `PG_COMPONENT_PSQL_CONNECTION_STRING`.
 */
export async function createPgAdapter(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; metrics: IMetricsComponent<string> },
    'config' | 'logs' | 'metrics'
  >
): Promise<IPgComponent> {
  const pg = await createBasePgComponent(components, {
    migration: {
      dir: resolve(__dirname, '../../migrations'),
      migrationsTable: 'pgmigrations',
      ignorePattern: '.*\\.map',
      direction: 'up'
    }
  })

  async function getCount(query: SQLStatement): Promise<number> {
    const result = await pg.query<{ count: string }>(query)
    return Number(result.rows[0]?.count ?? 0)
  }

  async function exists(query: SQLStatement): Promise<boolean> {
    const result = await pg.query(query)
    return result.rowCount > 0
  }

  return { ...pg, getCount, exists }
}
