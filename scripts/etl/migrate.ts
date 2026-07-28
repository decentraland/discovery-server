/* eslint-disable no-console */
import type { Pool, PoolClient } from 'pg'
import { sanitizeDescription, sanitizeImageUrl, sanitizePlainText } from '../../src/logic/content-sanitization'

/**
 * One-off ETL from the legacy places + events Postgres databases into the
 * discovery-server squashed schema. Every load is idempotent
 * (INSERT ... ON CONFLICT) and runs inside a per-table transaction so a failure
 * rolls that table back instead of leaving a partial load.
 *
 * Transforms mirror the DB plan:
 * - gatsby CHAR columns are btrimmed and cast to native uuid/text;
 * - timezone handling is per-column, not per-DB: the places/worlds tables, the
 *   events `profile_settings` (gatsby `Type.TimeStampTZ`, which is misleadingly a naive
 *   `timestamp WITHOUT time zone`), and the two never-converted naive columns
 *   `events.deleted_at` + `event_attendees.created_at` are all read `AT TIME ZONE 'UTC'`;
 *   the events table's own timestamps (start_at, finish_at, next_start_at, next_finish_at,
 *   recurrent_until, recurrent_dates, created_at, updated_at) and the `schedule` table were
 *   migrated to real `timestamptz` and are copied verbatim;
 * - the polymorphic events.place_id is split into place_id (uuid) / world_id (text);
 * - likes/favorites/content-ratings gain an explicit entity_type and legacy world
 *   interactions keyed by a world's place-uuid are re-pointed to the world id;
 * - denormalized aggregates (places/worlds like counts, events attendee counters)
 *   are recomputed from the loaded child rows.
 */

export type EtlPools = { placesSource: Pool; eventsSource: Pool; target: Pool }
export type EtlOptions = { dryRun?: boolean; since?: string }
export type TableReport = { table: string; source: number; loaded: number }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INT4_MAX = 2147483647
/** Matches interactions-repository.MIN_USER_ACTIVITY (the Wilson-score activity floor). */
const MIN_USER_ACTIVITY = 100

/** Run `fn` inside a single target transaction so a table load is all-or-nothing. */
async function withTargetTx<T>(pools: EtlPools, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pools.target.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** Optional `--since` delta filter on a table's `updated_at` (parameterized). */
function sinceClause(options: EtlOptions): { where: string; params: string[] } {
  return options.since ? { where: ' WHERE updated_at > $1', params: [options.since] } : { where: '', params: [] }
}

/** Classify a legacy entity_id (place UUID vs world name) for likes/favorites. */
export function classifyEntity(entityId: string): 'place' | 'world' {
  return UUID_RE.test(entityId.trim()) ? 'place' : 'world'
}

/**
 * Normalize a legacy interaction entity_id to the discovery model: a place uuid
 * stays a place, a world name is a world, and a world's legacy place-uuid is
 * re-pointed to its world id. `worldPlaceMap` maps place-uuid (lowercase) ->
 * world_id for the legacy world rows that live in the places table.
 */
function repointEntity(
  rawEntityId: string,
  worldPlaceMap: Map<string, string>
): { entityId: string; entityType: 'place' | 'world' } {
  const trimmed = rawEntityId.trim()
  if (UUID_RE.test(trimmed)) {
    const lower = trimmed.toLowerCase()
    const worldId = worldPlaceMap.get(lower)
    if (worldId) return { entityId: worldId, entityType: 'world' }
    return { entityId: lower, entityType: 'place' }
  }
  return { entityId: trimmed.toLowerCase(), entityType: 'world' }
}

/** Places-table world rows keyed by place-uuid -> world_id, used to re-point interactions. */
async function loadWorldPlaceMap(pools: EtlPools): Promise<Map<string, string>> {
  const { rows } = await pools.target.query<{ place_id: string; world_id: string }>(
    `SELECT id::text AS place_id, world_id FROM places WHERE world IS true AND world_id IS NOT NULL`
  )
  return new Map(rows.map((r) => [r.place_id.toLowerCase(), r.world_id.toLowerCase()]))
}

/** Copy worlds (btrim owner, lowercase id for the worlds_id_lowercase CHECK, naive ts -> UTC). */
export async function migrateWorlds(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { where, params } = sinceClause(options)
  const { rows } = await pools.placesSource.query(
    `SELECT id, world_name, title, description, image, content_rating, categories, btrim(owner) AS owner,
            show_in_places, single_player, skybox_time, is_private, likes, dislikes, favorites, like_rate,
            like_score, highlighted, highlighted_image, ranking,
            created_at AT TIME ZONE 'UTC' AS created_at, updated_at AT TIME ZONE 'UTC' AS updated_at
     FROM worlds${where}`,
    params
  )
  let loaded = 0
  if (!options.dryRun) {
    await withTargetTx(pools, async (client) => {
      for (const w of rows) {
        await client.query(
          `INSERT INTO worlds (id, world_name, title, description, image, content_rating, categories, owner,
             show_in_places, single_player, skybox_time, is_private, likes, dislikes, favorites, like_rate,
             like_score, highlighted, highlighted_image, ranking, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           ON CONFLICT (id) DO UPDATE SET world_name = EXCLUDED.world_name, title = EXCLUDED.title,
             description = EXCLUDED.description, image = EXCLUDED.image, content_rating = EXCLUDED.content_rating,
             categories = EXCLUDED.categories, owner = EXCLUDED.owner, show_in_places = EXCLUDED.show_in_places,
             single_player = EXCLUDED.single_player, skybox_time = EXCLUDED.skybox_time,
             is_private = EXCLUDED.is_private, highlighted = EXCLUDED.highlighted,
             highlighted_image = EXCLUDED.highlighted_image, ranking = EXCLUDED.ranking,
             updated_at = EXCLUDED.updated_at`,
          [
            String(w.id).toLowerCase(), w.world_name, sanitizePlainText(w.title), sanitizeDescription(w.description), sanitizeImageUrl(w.image), w.content_rating, w.categories,
            w.owner, w.show_in_places, w.single_player, w.skybox_time, w.is_private, w.likes, w.dislikes, w.favorites,
            w.like_rate, w.like_score, w.highlighted, sanitizeImageUrl(w.highlighted_image), w.ranking, w.created_at, w.updated_at
          ]
        )
        loaded++
      }
    })
  }
  return { table: 'worlds', source: rows.length, loaded }
}

/** Places: btrim gatsby CHAR id/owner/creator, cast id to uuid, copy textsearch, naive ts -> UTC. */
export async function migratePlaces(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { where, params } = sinceClause(options)
  const { rows } = await pools.placesSource.query(
    `SELECT btrim(id) AS id, title, description, image, btrim(owner) AS owner, btrim(creator_address) AS creator_address,
            positions, base_position, contact_name, contact_email, content_rating, likes, dislikes, favorites,
            like_rate, like_score, ranking, highlighted, highlighted_image, disabled,
            disabled_at AT TIME ZONE 'UTC' AS disabled_at, disabled_reason, world, world_name, world_id,
            deployed_at AT TIME ZONE 'UTC' AS deployed_at, categories, sdk, textsearch,
            created_at AT TIME ZONE 'UTC' AS created_at, updated_at AT TIME ZONE 'UTC' AS updated_at
     FROM places${where}`,
    params
  )
  // Resolve world_id against the target so a missing/case-mismatched ref becomes NULL
  // rather than an FK violation that aborts the run.
  const worldIds = new Set((await pools.target.query<{ id: string }>(`SELECT id FROM worlds`)).rows.map((r) => r.id))
  let loaded = 0
  if (!options.dryRun) {
    await withTargetTx(pools, async (client) => {
      for (const p of rows) {
        const worldId = p.world_id ? String(p.world_id).trim().toLowerCase() : null
        const resolvedWorldId = worldId && worldIds.has(worldId) ? worldId : null
        await client.query(
          `INSERT INTO places (id, title, description, image, owner, creator_address, positions, base_position,
             contact_name, contact_email, content_rating, likes, dislikes, favorites, like_rate, like_score, ranking,
             highlighted, highlighted_image, disabled, disabled_at, disabled_reason, world, world_name, world_id,
             deployed_at, categories, sdk, textsearch, created_at, updated_at)
           VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
             image = EXCLUDED.image, owner = EXCLUDED.owner, creator_address = EXCLUDED.creator_address,
             positions = EXCLUDED.positions, base_position = EXCLUDED.base_position,
             contact_name = EXCLUDED.contact_name, contact_email = EXCLUDED.contact_email,
             content_rating = EXCLUDED.content_rating, ranking = EXCLUDED.ranking, highlighted = EXCLUDED.highlighted,
             highlighted_image = EXCLUDED.highlighted_image, disabled = EXCLUDED.disabled,
             disabled_at = EXCLUDED.disabled_at, disabled_reason = EXCLUDED.disabled_reason,
             world_name = EXCLUDED.world_name, world_id = EXCLUDED.world_id, deployed_at = EXCLUDED.deployed_at,
             categories = EXCLUDED.categories, sdk = EXCLUDED.sdk, textsearch = EXCLUDED.textsearch,
             updated_at = EXCLUDED.updated_at`,
          [
            p.id, sanitizePlainText(p.title), sanitizeDescription(p.description), sanitizeImageUrl(p.image), p.owner, p.creator_address, p.positions, p.base_position,
            sanitizePlainText(p.contact_name), sanitizePlainText(p.contact_email), p.content_rating, p.likes, p.dislikes, p.favorites, p.like_rate,
            p.like_score, p.ranking, p.highlighted, sanitizeImageUrl(p.highlighted_image), p.disabled, p.disabled_at, p.disabled_reason,
            p.world, p.world_name, resolvedWorldId, p.deployed_at, p.categories, p.sdk, p.textsearch, p.created_at,
            p.updated_at
          ]
        )
        loaded++
      }
    })
  }
  return { table: 'places', source: rows.length, loaded }
}

/** Rebuild the place_categories pivot from the denormalized places.categories[] array. */
export async function migratePlaceCategories(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  if (options.dryRun) {
    const { rows } = await pools.target.query<{ count: string }>(
      `SELECT count(*) AS count FROM places p, unnest(p.categories) AS cat JOIN categories c ON c.name = cat`
    )
    const total = Number(rows[0]?.count ?? 0)
    return { table: 'place_categories', source: total, loaded: 0 }
  }
  const loaded = await withTargetTx(pools, async (client) => {
    // JOIN to categories so only known category slugs are inserted (FK-safe).
    const result = await client.query(
      `INSERT INTO place_categories (category_id, place_id)
       SELECT c.name, p.id FROM places p, unnest(p.categories) AS cat JOIN categories c ON c.name = cat
       ON CONFLICT DO NOTHING`
    )
    return result.rowCount ?? 0
  })
  return { table: 'place_categories', source: loaded, loaded }
}

/** Curated event collections (legacy `schedule` -> `schedules`). All timestamps are already tz. */
export async function migrateSchedules(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { where, params } = sinceClause(options)
  const { rows } = await pools.eventsSource.query(
    `SELECT btrim(id) AS id, name, description, background, image, theme, active, active_since, active_until,
            created_at, updated_at
     FROM schedule${where}`,
    params
  )
  let loaded = 0
  if (!options.dryRun) {
    await withTargetTx(pools, async (client) => {
      for (const s of rows) {
        await client.query(
          `INSERT INTO schedules (id, name, description, background, image, theme, active, active_since, active_until,
             created_at, updated_at)
           VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
             background = EXCLUDED.background, image = EXCLUDED.image, theme = EXCLUDED.theme, active = EXCLUDED.active,
             active_since = EXCLUDED.active_since, active_until = EXCLUDED.active_until, updated_at = EXCLUDED.updated_at`,
          [
            s.id, s.name, s.description, s.background ?? [], s.image, s.theme, s.active, s.active_since, s.active_until,
            s.created_at, s.updated_at
          ]
        )
        loaded++
      }
    })
  }
  return { table: 'schedules', source: rows.length, loaded }
}

/** Events: split polymorphic place_id -> place_id (uuid) / world_id (text); drop legacy columns. */
export async function migrateEvents(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { where, params } = sinceClause(options)
  const { rows } = await pools.eventsSource.query(
    `SELECT id, name, image, image_vertical, description, start_at, finish_at, duration, all_day, next_start_at,
            next_finish_at, recurrent, recurrent_frequency, recurrent_setpos, recurrent_monthday,
            recurrent_weekday_mask, recurrent_month_mask, recurrent_interval, recurrent_count, recurrent_until,
            recurrent_dates, x, y, server, world, estate_id, estate_name, scene_name, place_id, community_id, url,
            "user", user_name, contact, details, approved, rejected, approved_by, rejected_by, rejection_reason,
            highlighted, total_attendees, latest_attendees, categories, schedules, textsearch, deleted_by_user,
            deleted_by_admin, deleted_by, deleted_at AT TIME ZONE 'UTC' AS deleted_at, deleted_reason,
            created_at, updated_at
     FROM events${where}`,
    params
  )

  // Resolve which target place/world/schedule ids exist so unresolved references
  // become NULL / are filtered (not FK violations that abort the run).
  const placeIds = new Set((await pools.target.query<{ id: string }>(`SELECT id::text AS id FROM places`)).rows.map((r) => r.id))
  const worldIds = new Set((await pools.target.query<{ id: string }>(`SELECT id FROM worlds`)).rows.map((r) => r.id))
  const scheduleIds = new Set(
    (await pools.target.query<{ id: string }>(`SELECT id::text AS id FROM schedules`)).rows.map((r) => r.id)
  )
  // Legacy world events store the world's places-table UUID in place_id; this maps that
  // uuid -> discovery world_id (same mechanism used to re-point world interactions).
  const worldPlaceMap = await loadWorldPlaceMap(pools)

  let loaded = 0
  let nulledRefs = 0
  let cappedDurations = 0
  if (!options.dryRun) {
    await withTargetTx(pools, async (client) => {
      for (const e of rows) {
        const legacyRef: string | null = e.place_id ? String(e.place_id).trim() : null
        let placeId: string | null = null
        let worldId: string | null = null
        if (e.world) {
          // Resolve the world id from the world NAME (in `server`) first, then fall back to
          // the legacy world place-uuid (in place_id) via the world place map.
          const serverName = e.server ? String(e.server).trim().toLowerCase() : null
          if (serverName && worldIds.has(serverName)) {
            worldId = serverName
          } else if (legacyRef && UUID_RE.test(legacyRef)) {
            worldId = worldPlaceMap.get(legacyRef.toLowerCase()) ?? null
          } else if (legacyRef && worldIds.has(legacyRef.toLowerCase())) {
            worldId = legacyRef.toLowerCase()
          }
          if (!worldId && (serverName || legacyRef)) nulledRefs++
        } else if (legacyRef && UUID_RE.test(legacyRef)) {
          // placeIds holds canonical lowercase uuid::text — match case-insensitively.
          const lower = legacyRef.toLowerCase()
          placeId = placeIds.has(lower) ? lower : null
          if (!placeId) nulledRefs++
        }

        // schedules is uuid[]; keep only well-formed uuids that exist in the target.
        const schedules: string[] = (e.schedules ?? [])
          .map((s: string) => String(s).trim().toLowerCase())
          .filter((s: string) => UUID_RE.test(s) && scheduleIds.has(s))

        // Legacy duration is BIGINT (node-pg returns it as a string); the target column is
        // int4 ms, so coerce and cap pathological values instead of overflowing.
        // Target column is `integer NOT NULL`; coalesce a null/non-numeric legacy duration to 0
        // (a null would otherwise abort the whole events transaction) and cap int4 overflow.
        let duration = e.duration === null || e.duration === undefined ? 0 : Number(e.duration)
        if (!Number.isFinite(duration)) duration = 0
        if (duration > INT4_MAX) {
          duration = INT4_MAX
          cappedDurations++
        }

        await client.query(
          `INSERT INTO events (id, name, image, image_vertical, description, start_at, finish_at, duration, all_day,
             next_start_at, next_finish_at, recurrent, recurrent_frequency, recurrent_setpos, recurrent_monthday,
             recurrent_weekday_mask, recurrent_month_mask, recurrent_interval, recurrent_count, recurrent_until,
             recurrent_dates, x, y, server, world, estate_id, estate_name, scene_name, place_id, world_id,
             community_id, url, "user", user_name, contact, details, approved, rejected, approved_by, rejected_by,
             rejection_reason, highlighted, total_attendees, latest_attendees, categories, schedules, textsearch,
             deleted_by_user, deleted_by_admin, deleted_by, deleted_at, deleted_reason, created_at, updated_at)
           VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
             $26,$27,$28,$29::uuid,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,
             $50,$51,$52,$53,$54)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image = EXCLUDED.image,
             image_vertical = EXCLUDED.image_vertical, description = EXCLUDED.description,
             start_at = EXCLUDED.start_at, finish_at = EXCLUDED.finish_at, duration = EXCLUDED.duration,
             all_day = EXCLUDED.all_day, next_start_at = EXCLUDED.next_start_at,
             next_finish_at = EXCLUDED.next_finish_at, recurrent = EXCLUDED.recurrent,
             recurrent_frequency = EXCLUDED.recurrent_frequency, recurrent_setpos = EXCLUDED.recurrent_setpos,
             recurrent_monthday = EXCLUDED.recurrent_monthday, recurrent_weekday_mask = EXCLUDED.recurrent_weekday_mask,
             recurrent_month_mask = EXCLUDED.recurrent_month_mask, recurrent_interval = EXCLUDED.recurrent_interval,
             recurrent_count = EXCLUDED.recurrent_count, recurrent_until = EXCLUDED.recurrent_until,
             recurrent_dates = EXCLUDED.recurrent_dates, x = EXCLUDED.x, y = EXCLUDED.y, server = EXCLUDED.server,
             world = EXCLUDED.world, estate_id = EXCLUDED.estate_id, estate_name = EXCLUDED.estate_name,
             scene_name = EXCLUDED.scene_name, place_id = EXCLUDED.place_id, world_id = EXCLUDED.world_id,
             community_id = EXCLUDED.community_id, url = EXCLUDED.url, user_name = EXCLUDED.user_name,
             contact = EXCLUDED.contact, details = EXCLUDED.details, approved = EXCLUDED.approved,
             rejected = EXCLUDED.rejected, approved_by = EXCLUDED.approved_by, rejected_by = EXCLUDED.rejected_by,
             rejection_reason = EXCLUDED.rejection_reason, highlighted = EXCLUDED.highlighted,
             categories = EXCLUDED.categories, schedules = EXCLUDED.schedules, textsearch = EXCLUDED.textsearch,
             deleted_by_user = EXCLUDED.deleted_by_user, deleted_by_admin = EXCLUDED.deleted_by_admin,
             deleted_by = EXCLUDED.deleted_by, deleted_at = EXCLUDED.deleted_at,
             deleted_reason = EXCLUDED.deleted_reason, updated_at = EXCLUDED.updated_at`,
          [
            e.id, e.name, sanitizeImageUrl(e.image), sanitizeImageUrl(e.image_vertical), sanitizeDescription(e.description), e.start_at, e.finish_at, duration, e.all_day,
            e.next_start_at, e.next_finish_at, e.recurrent, e.recurrent_frequency, e.recurrent_setpos,
            e.recurrent_monthday, e.recurrent_weekday_mask, e.recurrent_month_mask, e.recurrent_interval,
            e.recurrent_count, e.recurrent_until, e.recurrent_dates, e.x, e.y, e.server, e.world, e.estate_id,
            e.estate_name, e.scene_name, placeId, worldId, e.community_id, e.url, e.user, e.user_name, e.contact,
            e.details, e.approved, e.rejected, e.approved_by, e.rejected_by, e.rejection_reason, e.highlighted,
            e.total_attendees, e.latest_attendees, e.categories, schedules, e.textsearch, e.deleted_by_user,
            e.deleted_by_admin, e.deleted_by, e.deleted_at, e.deleted_reason, e.created_at, e.updated_at
          ]
        )
        loaded++
      }
    })
  }
  if (nulledRefs) console.log(`  events: ${nulledRefs} unresolved place/world references set to NULL`)
  if (cappedDurations) console.log(`  events: ${cappedDurations} oversized durations capped to int4 max`)
  return { table: 'events', source: rows.length, loaded }
}

/** Event attendees (native uuid event_id, tz created_at). Recompute the event counters after. */
export async function migrateEventAttendees(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { rows } = await pools.eventsSource.query(
    // event_attendees.created_at is a naive `timestamp` (never converted); read it as UTC.
    `SELECT event_id, "user", user_name, created_at AT TIME ZONE 'UTC' AS created_at FROM event_attendees`
  )
  // Only attach attendees whose event survived the events load.
  const eventIds = new Set((await pools.target.query<{ id: string }>(`SELECT id::text AS id FROM events`)).rows.map((r) => r.id))
  let loaded = 0
  if (!options.dryRun) {
    await withTargetTx(pools, async (client) => {
      for (const a of rows) {
        if (!eventIds.has(String(a.event_id).toLowerCase())) continue
        await client.query(
          `INSERT INTO event_attendees (event_id, "user", user_name, created_at)
           VALUES ($1::uuid, $2, $3, $4)
           ON CONFLICT (event_id, "user") DO UPDATE SET user_name = EXCLUDED.user_name`,
          [String(a.event_id).toLowerCase(), String(a.user).toLowerCase(), a.user_name, a.created_at]
        )
        loaded++
      }
      // Recompute denormalized counters from the loaded attendee rows (fixes legacy drift).
      await client.query(`
        UPDATE events e SET
          total_attendees = coalesce(agg.cnt, 0),
          latest_attendees = coalesce(agg.latest, '{}')
        FROM events base
        LEFT JOIN (
          SELECT event_id, count(*) AS cnt,
                 (array_agg("user" ORDER BY created_at DESC))[1:10] AS latest
          FROM event_attendees GROUP BY event_id
        ) agg ON agg.event_id = base.id
        WHERE e.id = base.id`)
    })
  }
  return { table: 'event_attendees', source: rows.length, loaded }
}

/** User likes: btrim CHAR cols, re-point world interactions, dedup keeping the latest updated_at. */
export async function migrateUserLikes(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { rows } = await pools.placesSource.query(
    `SELECT btrim(entity_id) AS entity_id, btrim("user") AS "user", user_activity, "like",
            created_at AT TIME ZONE 'UTC' AS created_at, updated_at AT TIME ZONE 'UTC' AS updated_at
     FROM user_likes`
  )
  let loaded = 0
  if (!options.dryRun) {
    const worldPlaceMap = await loadWorldPlaceMap(pools)
    await withTargetTx(pools, async (client) => {
      for (const l of rows) {
        const { entityId, entityType } = repointEntity(l.entity_id, worldPlaceMap)
        await client.query(
          `INSERT INTO user_likes (entity_id, entity_type, "user", user_activity, "like", created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (entity_id, "user") DO UPDATE
             SET "like" = EXCLUDED."like", user_activity = EXCLUDED.user_activity,
                 entity_type = EXCLUDED.entity_type, updated_at = EXCLUDED.updated_at
             WHERE EXCLUDED.updated_at >= user_likes.updated_at`,
          [entityId, entityType, String(l.user).toLowerCase(), l.user_activity, l.like, l.created_at, l.updated_at]
        )
        loaded++
      }
    })
  }
  return { table: 'user_likes', source: rows.length, loaded }
}

/** User favorites: like migrateUserLikes but keyed without a `like`/`updated_at` (dedup on created_at). */
export async function migrateUserFavorites(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { rows } = await pools.placesSource.query(
    `SELECT btrim(entity_id) AS entity_id, btrim("user") AS "user", user_activity,
            created_at AT TIME ZONE 'UTC' AS created_at
     FROM user_favorites`
  )
  let loaded = 0
  if (!options.dryRun) {
    const worldPlaceMap = await loadWorldPlaceMap(pools)
    await withTargetTx(pools, async (client) => {
      for (const f of rows) {
        const { entityId, entityType } = repointEntity(f.entity_id, worldPlaceMap)
        await client.query(
          `INSERT INTO user_favorites (entity_id, entity_type, "user", user_activity, created_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (entity_id, "user") DO UPDATE
             SET user_activity = EXCLUDED.user_activity, entity_type = EXCLUDED.entity_type,
                 created_at = EXCLUDED.created_at
             WHERE EXCLUDED.created_at >= user_favorites.created_at`,
          [entityId, entityType, String(f.user).toLowerCase(), f.user_activity, f.created_at]
        )
        loaded++
      }
    })
  }
  return { table: 'user_favorites', source: rows.length, loaded }
}

/** Content-rating audit rows (immutable; keep the legacy id). moderator is NOT NULL in the target. */
export async function migrateContentRatings(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { rows } = await pools.placesSource.query(
    `SELECT btrim(id) AS id, btrim(entity_id) AS entity_id, original_rating, update_rating,
            coalesce(btrim(moderator), '') AS moderator, comment, created_at AT TIME ZONE 'UTC' AS created_at
     FROM content_ratings`
  )
  let loaded = 0
  if (!options.dryRun) {
    const worldPlaceMap = await loadWorldPlaceMap(pools)
    await withTargetTx(pools, async (client) => {
      for (const r of rows) {
        const { entityId } = repointEntity(r.entity_id, worldPlaceMap)
        await client.query(
          `INSERT INTO content_ratings (id, entity_id, original_rating, update_rating, moderator, comment, created_at)
           VALUES ($1::uuid,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO NOTHING`,
          [r.id, entityId, r.original_rating, r.update_rating, r.moderator, r.comment, r.created_at]
        )
        loaded++
      }
    })
  }
  return { table: 'content_ratings', source: rows.length, loaded }
}

/** Profile settings, trimmed to permissions. Only rows with a non-empty permission set are carried. */
export async function migrateProfileSettings(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { rows } = await pools.eventsSource.query(
    `SELECT "user", permissions, created_at AT TIME ZONE 'UTC' AS created_at, updated_at AT TIME ZONE 'UTC' AS updated_at
     FROM profile_settings
     WHERE permissions IS NOT NULL AND array_length(permissions, 1) > 0`
  )
  let loaded = 0
  if (!options.dryRun) {
    await withTargetTx(pools, async (client) => {
      for (const p of rows) {
        await client.query(
          `INSERT INTO profile_settings ("user", permissions, created_at, updated_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT ("user") DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = EXCLUDED.updated_at`,
          [String(p.user).toLowerCase(), p.permissions, p.created_at, p.updated_at]
        )
        loaded++
      }
    })
  }
  return { table: 'profile_settings', source: rows.length, loaded }
}

/** Notification cursors (bigint epoch-ms columns; SNS cron idempotency). */
export async function migrateNotificationCursors(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { rows } = await pools.eventsSource.query(
    `SELECT id, last_successful_run_at, created_at, updated_at FROM notification_cursors`
  )
  let loaded = 0
  if (!options.dryRun) {
    await withTargetTx(pools, async (client) => {
      for (const c of rows) {
        await client.query(
          `INSERT INTO notification_cursors (id, last_successful_run_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE
             SET last_successful_run_at = EXCLUDED.last_successful_run_at, updated_at = EXCLUDED.updated_at`,
          [c.id, c.last_successful_run_at, c.created_at, c.updated_at]
        )
        loaded++
      }
    })
  }
  return { table: 'notification_cursors', source: rows.length, loaded }
}

/**
 * Recompute the denormalized like/dislike/favorite/like_rate/like_score columns on
 * places and worlds from the loaded interactions, using the exact Wilson-score
 * lower-bound formula from interactions-repository (MIN_USER_ACTIVITY floor).
 */
export async function recomputeEntityAggregates(pools: EtlPools, options: EtlOptions = {}): Promise<void> {
  if (options.dryRun) return
  const forTable = (table: 'places' | 'worlds', entityType: 'place' | 'world', idExpr: string) => `
    WITH lk AS (
      SELECT entity_id,
        count(*) filter (where "like") AS likes,
        count(*) filter (where not "like") AS dislikes,
        count(*) filter (where user_activity >= ${MIN_USER_ACTIVITY}) AS active_total,
        count(*) filter (where "like" and user_activity >= ${MIN_USER_ACTIVITY}) AS active_likes,
        count(*) filter (where not "like" and user_activity >= ${MIN_USER_ACTIVITY}) AS active_dislikes
      FROM user_likes WHERE entity_type = '${entityType}' GROUP BY entity_id
    ),
    fv AS (SELECT entity_id, count(*) AS favorites FROM user_favorites WHERE entity_type = '${entityType}' GROUP BY entity_id)
    UPDATE ${table} t SET
      likes = coalesce(lk.likes, 0),
      dislikes = coalesce(lk.dislikes, 0),
      favorites = coalesce(fv.favorites, 0),
      like_rate = CASE WHEN coalesce(lk.active_total, 0) = 0 THEN NULL
                       ELSE lk.active_likes::float / lk.active_total END,
      like_score = CASE WHEN coalesce(lk.active_likes, 0) + coalesce(lk.active_dislikes, 0) > 0 THEN
        ((lk.active_likes + 1.9208) / (lk.active_likes + lk.active_dislikes)
          - 1.96 * SQRT((lk.active_likes * lk.active_dislikes) / (lk.active_likes + lk.active_dislikes) + 0.9604)
          / (lk.active_likes + lk.active_dislikes))
        / (1 + 3.8416 / (lk.active_likes + lk.active_dislikes))
        ELSE NULL END
    FROM ${table} base
    LEFT JOIN lk ON lk.entity_id = ${idExpr}
    LEFT JOIN fv ON fv.entity_id = ${idExpr}
    WHERE t.id = base.id`
  await withTargetTx(pools, async (client) => {
    await client.query(forTable('places', 'place', 'base.id::text'))
    await client.query(forTable('worlds', 'world', 'base.id'))
  })
}

/** TRUNCATE the ETL-owned target tables (for `--fresh`), CASCADE to clear FK children. */
export async function truncateTarget(pools: EtlPools): Promise<void> {
  await pools.target.query(`
    TRUNCATE event_attendees, events, place_categories, user_likes, user_favorites, content_ratings,
      places, worlds, schedules, profile_settings, notification_cursors RESTART IDENTITY CASCADE`)
}

/** Compare source vs target row counts for a spot-check after a load. */
export async function verify(pools: EtlPools): Promise<Array<{ check: string; ok: boolean; detail: string }>> {
  const results: Array<{ check: string; ok: boolean; detail: string }> = []
  const targetCount = async (table: string) =>
    Number((await pools.target.query<{ c: string }>(`SELECT count(*) AS c FROM ${table}`)).rows[0]?.c ?? 0)

  // No event references an id that isn't in places/worlds (all should have been resolved or nulled).
  const orphanEvents = Number(
    (
      await pools.target.query<{ c: string }>(
        `SELECT count(*) AS c FROM events e
         WHERE (e.place_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM places p WHERE p.id = e.place_id))
            OR (e.world_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM worlds w WHERE w.id = e.world_id))`
      )
    ).rows[0]?.c ?? 0
  )
  results.push({ check: 'events-orphan-refs', ok: orphanEvents === 0, detail: `${orphanEvents} orphaned refs` })

  // total_attendees matches the actual attendee row count.
  const drift = Number(
    (
      await pools.target.query<{ c: string }>(
        `SELECT count(*) AS c FROM events e
         WHERE e.total_attendees <> (SELECT count(*) FROM event_attendees a WHERE a.event_id = e.id)`
      )
    ).rows[0]?.c ?? 0
  )
  results.push({ check: 'attendee-counter-drift', ok: drift === 0, detail: `${drift} events with drifted counters` })

  // Source of truth per target table (renamed/derived noted). place_categories is derived from
  // places.categories[] and profile_settings is filtered to non-empty permissions, so their
  // counts are informational — no source comparison.
  const sourceOf: Record<string, { pool: Pool; table: string } | null> = {
    worlds: { pool: pools.placesSource, table: 'worlds' },
    places: { pool: pools.placesSource, table: 'places' },
    events: { pool: pools.eventsSource, table: 'events' },
    event_attendees: { pool: pools.eventsSource, table: 'event_attendees' },
    user_likes: { pool: pools.placesSource, table: 'user_likes' },
    user_favorites: { pool: pools.placesSource, table: 'user_favorites' },
    content_ratings: { pool: pools.placesSource, table: 'content_ratings' },
    schedules: { pool: pools.eventsSource, table: 'schedule' },
    notification_cursors: { pool: pools.eventsSource, table: 'notification_cursors' },
    profile_settings: null,
    place_categories: null
  }
  const sourceCount = async (pool: Pool, table: string) =>
    Number((await pool.query<{ c: string }>(`SELECT count(*) AS c FROM ${table}`)).rows[0]?.c ?? 0)

  for (const [table, src] of Object.entries(sourceOf)) {
    const target = await targetCount(table)
    if (!src) {
      results.push({ check: `${table}-count`, ok: true, detail: `${target} rows (derived/filtered)` })
      continue
    }
    const source = await sourceCount(src.pool, src.table)
    // Flag only a total load failure: nulled refs / dedup make target <= source expected.
    results.push({ check: `${table}-count`, ok: source === 0 || target > 0, detail: `source=${source} target=${target}` })
  }
  return results
}
