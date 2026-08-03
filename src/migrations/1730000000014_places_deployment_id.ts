import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE places ADD COLUMN IF NOT EXISTS deployment_id text;
    CREATE INDEX IF NOT EXISTS places_deployment_id_idx
      ON places (deployment_id) WHERE deployment_id IS NOT NULL;
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP INDEX IF EXISTS places_deployment_id_idx')
  pgm.sql('ALTER TABLE places DROP COLUMN IF EXISTS deployment_id')
}
