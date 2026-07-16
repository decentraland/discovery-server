import { Pool } from 'pg'
import { test } from '../components'
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
  type EtlPools
} from '../../scripts/etl/migrate'

// The app runner migrates the target (public) schema. We stage minimal legacy
// source tables in a separate schema and point a search_path-scoped pool at it,
// so the ETL transforms run against real Postgres without a second database.
test('when migrating legacy data with the ETL', function ({ components }) {
  const connectionString = process.env.PG_COMPONENT_PSQL_CONNECTION_STRING as string
  let pools: EtlPools

  beforeEach(async () => {
    await components.pg.query('DROP SCHEMA IF EXISTS legacy_places CASCADE')
    await components.pg.query('CREATE SCHEMA legacy_places')
    // Start from a clean target so assertions don't see rows other suites left behind.
    await components.pg.query(`
      TRUNCATE event_attendees, events, place_categories, user_likes, user_favorites, content_ratings,
        places, worlds, schedules, profile_settings, notification_cursors RESTART IDENTITY CASCADE`)

    // Legacy tables use gatsby CHAR columns; owner is over-wide to force blank padding.
    await components.pg.query(`
      CREATE TABLE legacy_places.worlds (
        id text PRIMARY KEY, world_name text, title text, description text, image text, content_rating text,
        categories varchar(50)[], owner char(50), show_in_places boolean, single_player boolean,
        skybox_time integer, is_private boolean, likes integer, dislikes integer, favorites integer,
        like_rate real, like_score real, highlighted boolean, highlighted_image text, ranking double precision,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
    await components.pg.query(`
      CREATE TABLE legacy_places.places (
        id char(36) PRIMARY KEY, title text, description text, image text, owner char(50), creator_address char(50),
        positions varchar(15)[], base_position varchar(15), contact_name text, contact_email text,
        content_rating varchar(4), likes integer, dislikes integer, favorites integer, like_rate real,
        like_score real, ranking double precision, highlighted boolean, highlighted_image text, disabled boolean,
        disabled_at timestamptz, disabled_reason varchar(20), world boolean, world_name text, world_id text,
        deployed_at timestamptz DEFAULT now(), categories varchar(50)[], sdk varchar(50), textsearch tsvector,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)

    await components.pg.query(`
      INSERT INTO legacy_places.worlds (id, world_name, content_rating, categories, owner, show_in_places,
        single_player, is_private, likes, dislikes, favorites, highlighted)
      VALUES ('my-world.dcl.eth', 'my-world.dcl.eth', 'RP', '{}', '0xowner', true, false, false, 0, 0, 0, false)`)
    await components.pg.query(`
      INSERT INTO legacy_places.places (id, title, owner, creator_address, positions, base_position,
        content_rating, likes, dislikes, favorites, highlighted, disabled, world, categories, textsearch)
      VALUES ('11111111-1111-1111-1111-111111111111', 'Genesis Plaza', '0xabc', '0xabc', '{"0,0"}', '0,0',
        'PR', 0, 0, 0, false, false, false, '{art}', to_tsvector('english', 'Genesis Plaza'))`)

    const source = new Pool({ connectionString, options: '-c search_path=legacy_places' })
    const target = new Pool({ connectionString })
    pools = { placesSource: source, eventsSource: source, target }
  })

  afterEach(async () => {
    await pools.placesSource.end()
    await pools.target.end()
    await components.pg.query('DROP SCHEMA IF EXISTS legacy_places CASCADE')
  })

  describe('and migrating worlds then places', () => {
    beforeEach(async () => {
      await migrateWorlds(pools)
      await migratePlaces(pools)
      await migratePlaceCategories(pools)
    })

    it('should cast the gatsby CHAR(36) id to a native uuid in the target', async () => {
      const result = await components.pg.query<{ id: string; title: string }>(
        `SELECT id, title FROM places WHERE base_position = '0,0'`
      )
      expect(result.rows[0]).toEqual({ id: '11111111-1111-1111-1111-111111111111', title: 'Genesis Plaza' })
    })

    it('should btrim the blank-padded owner column', async () => {
      const result = await components.pg.query<{ owner: string }>(
        `SELECT owner FROM places WHERE base_position = '0,0'`
      )
      expect(result.rows[0].owner).toBe('0xabc')
    })

    it('should copy the textsearch vector so place search works', async () => {
      const result = await components.pg.query<{ textsearch: string | null }>(
        `SELECT textsearch::text FROM places WHERE base_position = '0,0'`
      )
      expect(result.rows[0].textsearch).not.toBeNull()
    })

    it('should load the world', async () => {
      const result = await components.pg.query<{ id: string }>(`SELECT id FROM worlds`)
      expect(result.rows[0].id).toBe('my-world.dcl.eth')
    })

    it('should populate the place_categories pivot from the categories array', async () => {
      const result = await components.pg.query<{ category_id: string }>(`SELECT category_id FROM place_categories`)
      expect(result.rows.map((r) => r.category_id)).toContain('art')
    })
  })

  describe('and migrating a legacy world place-row with interactions keyed by its place-uuid', () => {
    const WORLD_PLACE_UUID = '22222222-2222-2222-2222-222222222222'

    beforeEach(async () => {
      // A world also lives as a row in the legacy places table (world=true, world_id set).
      await components.pg.query(`
        INSERT INTO legacy_places.places (id, title, owner, creator_address, positions, base_position,
          content_rating, likes, dislikes, favorites, highlighted, disabled, world, world_name, world_id, categories)
        VALUES ('${WORLD_PLACE_UUID}', 'My World', '0xowner', '0xowner', '{}', '', 'RP', 0, 0, 0, false, false, true,
          'my-world.dcl.eth', 'my-world.dcl.eth', '{}')`)

      await components.pg.query(`
        CREATE TABLE legacy_places.user_likes (
          entity_id char(36), "user" char(42), user_activity integer, "like" boolean,
          created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
      await components.pg.query(`
        CREATE TABLE legacy_places.user_favorites (
          entity_id char(36), "user" char(42), user_activity integer, created_at timestamptz DEFAULT now())`)

      // Like keyed by the world's place-uuid (must re-point to the world id) and one by the world name.
      await components.pg.query(`
        INSERT INTO legacy_places.user_likes (entity_id, "user", user_activity, "like")
        VALUES ('${WORLD_PLACE_UUID}', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 150, true),
               ('my-world.dcl.eth', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 150, true),
               ('11111111-1111-1111-1111-111111111111', '0xcccccccccccccccccccccccccccccccccccccccc', 150, true)`)
      await components.pg.query(`
        INSERT INTO legacy_places.user_favorites (entity_id, "user", user_activity)
        VALUES ('${WORLD_PLACE_UUID}', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0)`)

      await migrateWorlds(pools)
      await migratePlaces(pools)
      await migrateUserLikes(pools)
      await migrateUserFavorites(pools)
      await recomputeEntityAggregates(pools)
    })

    it('should re-point a like keyed by the world place-uuid to the world id', async () => {
      const result = await components.pg.query<{ entity_id: string; entity_type: string }>(
        `SELECT entity_id, entity_type FROM user_likes WHERE "user" = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'`
      )
      expect(result.rows[0]).toEqual({ entity_id: 'my-world.dcl.eth', entity_type: 'world' })
    })

    it('should classify a genesis-place like as a place', async () => {
      const result = await components.pg.query<{ entity_type: string }>(
        `SELECT entity_type FROM user_likes WHERE entity_id = '11111111-1111-1111-1111-111111111111'`
      )
      expect(result.rows[0].entity_type).toBe('place')
    })

    it('should recompute the world like count from the re-pointed interactions', async () => {
      const result = await components.pg.query<{ likes: number }>(
        `SELECT likes FROM worlds WHERE id = 'my-world.dcl.eth'`
      )
      expect(result.rows[0].likes).toBe(2)
    })
  })

  describe('and migrating events, attendees, schedules, profiles and cursors', () => {
    const EVENT_ID = '33333333-3333-3333-3333-333333333333'
    const SCHEDULE_ID = '44444444-4444-4444-4444-444444444444'

    beforeEach(async () => {
      await components.pg.query(`
        CREATE TABLE legacy_places.schedule (
          id char(36) PRIMARY KEY, name varchar(50), description varchar(255), background varchar(30)[],
          image varchar(255), theme varchar(25), active boolean DEFAULT false,
          active_since timestamptz DEFAULT now(), active_until timestamptz DEFAULT now(),
          created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
      await components.pg.query(`
        CREATE TABLE legacy_places.events (
          id uuid PRIMARY KEY, name text, image text, image_vertical text, description text,
          start_at timestamptz, finish_at timestamptz, duration integer, all_day boolean,
          next_start_at timestamptz, next_finish_at timestamptz, recurrent boolean, recurrent_frequency text,
          recurrent_setpos integer, recurrent_monthday integer, recurrent_weekday_mask integer,
          recurrent_month_mask integer, recurrent_interval integer, recurrent_count integer,
          recurrent_until timestamptz, recurrent_dates timestamptz[], x integer, y integer, server text,
          world boolean, estate_id text, estate_name text, scene_name text, place_id text, community_id text,
          url text, "user" text, user_name text, contact text, details text, approved boolean, rejected boolean,
          approved_by text, rejected_by text, rejection_reason text, highlighted boolean, total_attendees integer,
          latest_attendees text[], categories text[], schedules text[], textsearch tsvector, deleted_by_user boolean,
          deleted_by_admin boolean, deleted_by text, deleted_at timestamptz, deleted_reason text,
          created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
      await components.pg.query(`
        CREATE TABLE legacy_places.event_attendees (
          event_id uuid, "user" text, user_name text, created_at timestamptz DEFAULT now())`)
      await components.pg.query(`
        CREATE TABLE legacy_places.profile_settings (
          "user" text PRIMARY KEY, permissions varchar(25)[], created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now())`)
      await components.pg.query(`
        CREATE TABLE legacy_places.notification_cursors (
          id varchar PRIMARY KEY, last_successful_run_at bigint, created_at bigint, updated_at bigint)`)
      await components.pg.query(`
        CREATE TABLE legacy_places.content_ratings (
          id char(36) PRIMARY KEY, entity_id char(36), original_rating varchar(4), update_rating varchar(4),
          moderator char(42), comment text, created_at timestamptz DEFAULT now())`)

      await components.pg.query(`
        INSERT INTO legacy_places.schedule (id, name, background, active)
        VALUES ('${SCHEDULE_ID}', 'MVFW', '{}', true)`)
      await components.pg.query(`
        INSERT INTO legacy_places.events (id, name, start_at, finish_at, duration, all_day, recurrent,
          recurrent_weekday_mask, recurrent_month_mask, recurrent_interval, recurrent_dates, "user", approved,
          rejected, world, highlighted, total_attendees, latest_attendees, categories, schedules,
          deleted_by_user, deleted_by_admin, next_start_at, next_finish_at)
        VALUES ('${EVENT_ID}', 'Party', now(), now() + interval '1 hour', 3600000, false, false, 0, 0, 1, '{}',
          '0xowner', true, false, false, false, 99, '{}', '{}', '{${SCHEDULE_ID}}', false, false, now(),
          now() + interval '1 hour')`)
      await components.pg.query(`
        INSERT INTO legacy_places.event_attendees (event_id, "user", user_name)
        VALUES ('${EVENT_ID}', '0xAAA', 'A'), ('${EVENT_ID}', '0xBBB', 'B')`)
      await components.pg.query(`
        INSERT INTO legacy_places.profile_settings ("user", permissions)
        VALUES ('0xadmin', '{approve_any_event}'), ('0xnoperms', '{}')`)
      await components.pg.query(`
        INSERT INTO legacy_places.notification_cursors (id, last_successful_run_at, created_at, updated_at)
        VALUES ('events_started', 1700000000000, 1700000000000, 1700000000000)`)
      await components.pg.query(`
        INSERT INTO legacy_places.content_ratings (id, entity_id, update_rating, moderator)
        VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'R', '0xmod')`)

      await migratePlaces(pools)
      await migrateSchedules(pools)
      await migrateEvents(pools)
      await migrateEventAttendees(pools)
      await migrateProfileSettings(pools)
      await migrateNotificationCursors(pools)
      await migrateContentRatings(pools)
    })

    it('should load the schedule the event references', async () => {
      const result = await components.pg.query<{ id: string }>(`SELECT id FROM schedules`)
      expect(result.rows.map((r) => r.id)).toContain(SCHEDULE_ID)
    })

    it('should keep only the referenced schedule id on the event', async () => {
      const result = await components.pg.query<{ schedules: string[] }>(
        `SELECT schedules FROM events WHERE id = '${EVENT_ID}'`
      )
      expect(result.rows[0].schedules).toEqual([SCHEDULE_ID])
    })

    it('should recompute total_attendees from the loaded attendees, not the drifted source value', async () => {
      const result = await components.pg.query<{ total_attendees: number }>(
        `SELECT total_attendees FROM events WHERE id = '${EVENT_ID}'`
      )
      expect(result.rows[0].total_attendees).toBe(2)
    })

    it('should carry only profile settings with a non-empty permission set', async () => {
      const result = await components.pg.query<{ user: string }>(`SELECT "user" FROM profile_settings`)
      expect(result.rows.map((r) => r.user)).toEqual(['0xadmin'])
    })

    it('should load the notification cursor as epoch milliseconds', async () => {
      const result = await components.pg.query<{ last_successful_run_at: string }>(
        `SELECT last_successful_run_at FROM notification_cursors WHERE id = 'events_started'`
      )
      expect(Number(result.rows[0].last_successful_run_at)).toBe(1700000000000)
    })

    it('should load the content-rating audit row against the place id', async () => {
      const result = await components.pg.query<{ entity_id: string; update_rating: string }>(
        `SELECT entity_id, update_rating FROM content_ratings`
      )
      expect(result.rows[0]).toEqual({ entity_id: '11111111-1111-1111-1111-111111111111', update_rating: 'R' })
    })
  })

  describe('and re-running the interaction load after a source like is deleted', () => {
    const KEPT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const GONE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const PLACE_ID = '11111111-1111-1111-1111-111111111111'

    beforeEach(async () => {
      await components.pg.query(`
        CREATE TABLE legacy_places.user_likes (
          entity_id char(36), "user" char(42), user_activity integer, "like" boolean,
          created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
      await components.pg.query(`
        INSERT INTO legacy_places.user_likes (entity_id, "user", user_activity, "like")
        VALUES ('${PLACE_ID}', '${KEPT}', 150, true), ('${PLACE_ID}', '${GONE}', 150, true)`)
      await migrateWorlds(pools)
      await migratePlaces(pools)
      await migrateUserLikes(pools)
      // Simulate an unlike in the source, then re-run the (full) interaction load.
      await components.pg.query(`DELETE FROM legacy_places.user_likes WHERE "user" = '${GONE}'`)
      await migrateUserLikes(pools)
    })

    it('should remove the target like whose source row was deleted', async () => {
      const result = await components.pg.query<{ user: string }>(`SELECT "user" FROM user_likes ORDER BY "user"`)
      expect(result.rows.map((r) => r.user)).toEqual([KEPT])
    })
  })

  describe('and re-running the attendee load after a source attendee is deleted', () => {
    const EVENT_ID = '33333333-3333-3333-3333-333333333333'
    const KEPT = '0xaaa'
    const GONE = '0xbbb'

    beforeEach(async () => {
      await components.pg.query(`
        CREATE TABLE legacy_places.events (
          id uuid PRIMARY KEY, name text, image text, image_vertical text, description text,
          start_at timestamptz, finish_at timestamptz, duration integer, all_day boolean,
          next_start_at timestamptz, next_finish_at timestamptz, recurrent boolean, recurrent_frequency text,
          recurrent_setpos integer, recurrent_monthday integer, recurrent_weekday_mask integer,
          recurrent_month_mask integer, recurrent_interval integer, recurrent_count integer,
          recurrent_until timestamptz, recurrent_dates timestamptz[], x integer, y integer, server text,
          world boolean, estate_id text, estate_name text, scene_name text, place_id text, community_id text,
          url text, "user" text, user_name text, contact text, details text, approved boolean, rejected boolean,
          approved_by text, rejected_by text, rejection_reason text, highlighted boolean, total_attendees integer,
          latest_attendees text[], categories text[], schedules text[], textsearch tsvector, deleted_by_user boolean,
          deleted_by_admin boolean, deleted_by text, deleted_at timestamptz, deleted_reason text,
          created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
      await components.pg.query(`
        CREATE TABLE legacy_places.event_attendees (
          event_id uuid, "user" text, user_name text, created_at timestamptz DEFAULT now())`)
      await components.pg.query(`
        INSERT INTO legacy_places.events (id, name, start_at, finish_at, duration, all_day, recurrent,
          recurrent_weekday_mask, recurrent_month_mask, recurrent_interval, recurrent_dates, "user", approved,
          rejected, world, highlighted, total_attendees, latest_attendees, categories, schedules,
          deleted_by_user, deleted_by_admin, next_start_at, next_finish_at)
        VALUES ('${EVENT_ID}', 'Party', now(), now() + interval '1 hour', 3600000, false, false, 0, 0, 1, '{}',
          '0xowner', true, false, false, false, 0, '{}', '{}', '{}', false, false, now(), now() + interval '1 hour')`)
      await components.pg.query(`
        INSERT INTO legacy_places.event_attendees (event_id, "user", user_name)
        VALUES ('${EVENT_ID}', '${KEPT}', 'A'), ('${EVENT_ID}', '${GONE}', 'B')`)
      await migrateEvents(pools)
      await migrateEventAttendees(pools)
      // Simulate an unattend in the source, then re-run.
      await components.pg.query(`DELETE FROM legacy_places.event_attendees WHERE "user" = '${GONE}'`)
      await migrateEventAttendees(pools)
    })

    it('should remove the attendee whose source row was deleted', async () => {
      const result = await components.pg.query<{ user: string }>(`SELECT "user" FROM event_attendees`)
      expect(result.rows.map((r) => r.user)).toEqual([KEPT])
    })

    it('should recompute total_attendees down to the reconciled count', async () => {
      const result = await components.pg.query<{ total_attendees: number }>(
        `SELECT total_attendees FROM events WHERE id = '${EVENT_ID}'`
      )
      expect(result.rows[0].total_attendees).toBe(1)
    })
  })
})
