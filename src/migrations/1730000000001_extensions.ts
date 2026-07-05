import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  // gen_random_uuid() is in core since PG13, but pgcrypto guarantees it everywhere.
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pgcrypto')
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP EXTENSION IF EXISTS pgcrypto')
}
