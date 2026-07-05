import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Secondary parcel-position -> base-position index (Genesis scenes only), kept
// verbatim: it is on the hot path of position-based place filters.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE place_positions (
      position      varchar(15) PRIMARY KEY,
      base_position varchar(15) NOT NULL
    );

    CREATE INDEX place_positions_base_position_idx ON place_positions (base_position);
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS place_positions')
}
