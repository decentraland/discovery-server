import type { IPgComponent as IBasePgComponent } from '@dcl/pg-component'
import type { PoolClient } from 'pg'
import type { SQLStatement } from 'sql-template-strings'

/**
 * Anything a repository method can run SQL against: the pool-backed pg
 * component, or a transaction client threaded in by an orchestrating logic
 * component via `pg.withTransaction(tx => ...)`. Repositories accept this so
 * they own SQL but never own transactions.
 */
export type Queryable = Pick<IBasePgComponent, 'query'> | PoolClient

export interface IPgComponent extends IBasePgComponent {
  /** Runs a `SELECT count(*)`-style query and returns the numeric count. */
  getCount(query: SQLStatement): Promise<number>
  /** Runs a query and returns whether it yielded any row. */
  exists(query: SQLStatement): Promise<boolean>
}
