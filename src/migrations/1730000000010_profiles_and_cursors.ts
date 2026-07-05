import { MigrationBuilder } from 'node-pg-migrate'

export const shorthands = undefined

// Per-wallet profile settings, trimmed to what still drives behavior: the
// permissions array (authorization). The legacy email/notify/local-time columns
// are dropped — the email path is dead and the SNS notification crons never read
// them. `notification_cursors` provides SNS cron idempotency (epoch ms columns).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE profile_settings (
      "user"      text PRIMARY KEY,
      permissions varchar(25)[] NOT NULL DEFAULT '{}',
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX profile_settings_permissions_gin_idx ON profile_settings USING gin (permissions);

    CREATE TABLE notification_cursors (
      id                     varchar PRIMARY KEY,
      last_successful_run_at bigint,
      created_at             bigint NOT NULL,
      updated_at             bigint NOT NULL
    );
  `)
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS notification_cursors;
    DROP TABLE IF EXISTS profile_settings;
  `)
}
