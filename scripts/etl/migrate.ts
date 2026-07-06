/* eslint-disable no-console */
import type { Pool } from 'pg'

/**
 * One-off ETL from the legacy places + events Postgres databases into the
 * discovery-server squashed schema. Every load is idempotent
 * (INSERT ... ON CONFLICT DO UPDATE). Transforms mirror the DB plan: gatsby
 * CHAR columns are btrimmed and cast to native uuid/text, the polymorphic
 * events.place_id is split into place_id/world_id, likes/favorites gain an
 * explicit entity_type, and legacy-only columns are dropped.
 */

export type EtlPools = { placesSource: Pool; eventsSource: Pool; target: Pool }
export type EtlOptions = { dryRun?: boolean; batchSize?: number }

const DEFAULT_BATCH = 5000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type TableReport = { table: string; source: number; loaded: number }

async function count(pool: Pool, table: string): Promise<number> {
  const result = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)
  return Number(result.rows[0].n)
}

/** Copy worlds verbatim (btrim owner). */
export async function migrateWorlds(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { rows } = await pools.placesSource.query(`
    SELECT id, world_name, title, description, image, content_rating, categories, btrim(owner) AS owner,
           show_in_places, single_player, skybox_time, is_private, likes, dislikes, favorites, like_rate,
           like_score, highlighted, highlighted_image, ranking, created_at, updated_at
    FROM worlds`)
  let loaded = 0
  if (!options.dryRun) {
    for (const w of rows) {
      await pools.target.query(
        `INSERT INTO worlds (id, world_name, title, description, image, content_rating, categories, owner,
           show_in_places, single_player, skybox_time, is_private, likes, dislikes, favorites, like_rate,
           like_score, highlighted, highlighted_image, ranking, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (id) DO UPDATE SET world_name = EXCLUDED.world_name, title = EXCLUDED.title,
           description = EXCLUDED.description, image = EXCLUDED.image, updated_at = EXCLUDED.updated_at`,
        [
          w.id, w.world_name, w.title, w.description, w.image, w.content_rating, w.categories, w.owner,
          w.show_in_places, w.single_player, w.skybox_time, w.is_private, w.likes, w.dislikes, w.favorites,
          w.like_rate, w.like_score, w.highlighted, w.highlighted_image, w.ranking, w.created_at, w.updated_at
        ]
      )
      loaded++
    }
  }
  return { table: 'worlds', source: rows.length, loaded }
}

/** Places: btrim gatsby CHAR id/owner/creator and cast id to uuid. Keep legacy world rows. */
export async function migratePlaces(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { rows } = await pools.placesSource.query(`
    SELECT btrim(id) AS id, title, description, image, btrim(owner) AS owner, btrim(creator_address) AS creator_address,
           positions, base_position, contact_name, contact_email, content_rating, likes, dislikes, favorites,
           like_rate, like_score, ranking, highlighted, highlighted_image, disabled, disabled_at, disabled_reason,
           world, world_name, world_id, deployed_at, categories, sdk, created_at, updated_at
    FROM places`)
  let loaded = 0
  if (!options.dryRun) {
    for (const p of rows) {
      await pools.target.query(
        `INSERT INTO places (id, title, description, image, owner, creator_address, positions, base_position,
           contact_name, contact_email, content_rating, likes, dislikes, favorites, like_rate, like_score, ranking,
           highlighted, highlighted_image, disabled, disabled_at, disabled_reason, world, world_name, world_id,
           deployed_at, categories, sdk, created_at, updated_at)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
           image = EXCLUDED.image, positions = EXCLUDED.positions, categories = EXCLUDED.categories,
           disabled = EXCLUDED.disabled, deployed_at = EXCLUDED.deployed_at, updated_at = EXCLUDED.updated_at`,
        [
          p.id, p.title, p.description, p.image, p.owner, p.creator_address, p.positions, p.base_position,
          p.contact_name, p.contact_email, p.content_rating, p.likes, p.dislikes, p.favorites, p.like_rate,
          p.like_score, p.ranking, p.highlighted, p.highlighted_image, p.disabled, p.disabled_at, p.disabled_reason,
          p.world, p.world_name, p.world_id, p.deployed_at, p.categories, p.sdk, p.created_at, p.updated_at
        ]
      )
      loaded++
    }
  }
  return { table: 'places', source: rows.length, loaded }
}

/** Events: split polymorphic place_id -> place_id (uuid) / world_id (text); drop legacy columns. */
export async function migrateEvents(pools: EtlPools, options: EtlOptions = {}): Promise<TableReport> {
  const { rows } = await pools.eventsSource.query(`
    SELECT id, name, image, image_vertical, description, start_at, finish_at, duration, all_day, next_start_at,
           next_finish_at, recurrent, recurrent_frequency, recurrent_setpos, recurrent_monthday,
           recurrent_weekday_mask, recurrent_month_mask, recurrent_interval, recurrent_count, recurrent_until,
           recurrent_dates, x, y, server, world, estate_id, estate_name, scene_name, place_id, community_id, url,
           "user", user_name, contact, details, approved, rejected, approved_by, rejected_by, rejection_reason,
           highlighted, total_attendees, latest_attendees, categories, schedules, textsearch, deleted_by_user,
           deleted_by_admin, deleted_by, deleted_at, deleted_reason, created_at, updated_at
    FROM events`)

  // Resolve which target place/world ids exist so unresolved references become NULL (not FK violations).
  const placeIds = new Set((await pools.target.query<{ id: string }>(`SELECT id::text AS id FROM places`)).rows.map((r) => r.id))
  const worldIds = new Set((await pools.target.query<{ id: string }>(`SELECT id FROM worlds`)).rows.map((r) => r.id))

  let loaded = 0
  let nulledRefs = 0
  if (!options.dryRun) {
    for (const e of rows) {
      const legacyRef: string | null = e.place_id ? String(e.place_id).trim() : null
      let placeId: string | null = null
      let worldId: string | null = null
      if (e.world) {
        worldId = legacyRef && worldIds.has(legacyRef.toLowerCase()) ? legacyRef.toLowerCase() : null
        if (legacyRef && !worldId) nulledRefs++
      } else if (legacyRef && UUID_RE.test(legacyRef)) {
        placeId = placeIds.has(legacyRef) ? legacyRef : null
        if (!placeId) nulledRefs++
      }

      const schedules: string[] = (e.schedules ?? []).map((s: string) => String(s).trim()).filter(Boolean)

      await pools.target.query(
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
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, next_start_at = EXCLUDED.next_start_at,
           next_finish_at = EXCLUDED.next_finish_at, place_id = EXCLUDED.place_id, world_id = EXCLUDED.world_id,
           updated_at = EXCLUDED.updated_at`,
        [
          e.id, e.name, e.image, e.image_vertical, e.description, e.start_at, e.finish_at, e.duration, e.all_day,
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
  }
  if (nulledRefs) console.log(`  events: ${nulledRefs} unresolved place/world references set to NULL`)
  return { table: 'events', source: rows.length, loaded }
}

/** Classify a legacy entity_id (place UUID vs world name) for likes/favorites. */
export function classifyEntity(entityId: string): 'place' | 'world' {
  return UUID_RE.test(entityId.trim()) ? 'place' : 'world'
}
