/**
 * Shared domain DTOs served across the API. Grown per domain as phases land.
 */

export type Place = {
  id: string
  title: string | null
  description: string | null
  image: string | null
  owner: string | null
  creator_address: string | null
  positions: string[]
  base_position: string
  contact_name: string | null
  contact_email: string | null
  content_rating: string
  likes: number
  dislikes: number
  favorites: number
  like_rate: number | null
  like_score: number | null
  ranking: number | null
  highlighted: boolean
  highlighted_image: string | null
  disabled: boolean
  disabled_at: string | null
  disabled_reason: string | null
  world: boolean
  world_name: string | null
  world_id: string | null
  deployed_at: string
  categories: string[]
  sdk: string | null
  created_at: string
  updated_at: string
}

/** A place decorated with the requesting user's like/favorite state. */
export type AggregatePlace = Place & {
  user_like: boolean
  user_dislike: boolean
  user_favorite: boolean
  /** Realtime connected users, decorated from hot-scenes when available. */
  user_count?: number
  /** 30-day unique visitors, decorated from scene-stats when available. */
  user_visits?: number
}

/** Minimal status row returned by the by-ids status endpoint. */
export type PlaceStatus = Pick<Place, 'id' | 'disabled' | 'world' | 'world_name' | 'base_position'>

export type World = {
  id: string
  world_name: string
  title: string | null
  description: string | null
  image: string | null
  content_rating: string
  categories: string[]
  owner: string | null
  show_in_places: boolean
  single_player: boolean
  skybox_time: number | null
  is_private: boolean
  likes: number
  dislikes: number
  favorites: number
  like_rate: number | null
  like_score: number | null
  highlighted: boolean
  highlighted_image: string | null
  ranking: number | null
  created_at: string
  updated_at: string
  // Supplemented from the latest enabled place with this world_id (lateral join):
  contact_name: string | null
  contact_email: string | null
  creator_address: string | null
  sdk: string | null
  deployed_at: string | null
  // Synthesized constants the legacy world serializer always emitted (documented in worldSchema):
  world: boolean
  base_position: string
  disabled: boolean
  disabled_at: string | null
  user_visits: number
}

export type AggregateWorld = World & {
  user_like: boolean
  user_dislike: boolean
  user_favorite: boolean
  /** Realtime connected users, decorated from worlds-live-data when available. */
  user_count?: number
}

/** A unified discovery entity: a place or a world, in one shape. */
export type Destination = {
  id: string
  kind: 'place' | 'world'
  /** Legacy `AggregateDestinationAttributes.world` flag (kept alongside `kind` for legacy consumers). */
  world: boolean
  title: string | null
  description: string | null
  image: string | null
  base_position: string | null
  positions: string[]
  world_name: string | null
  owner: string | null
  content_rating: string
  categories: string[]
  likes: number
  dislikes: number
  favorites: number
  like_rate: number | null
  like_score: number | null
  highlighted: boolean
  highlighted_image: string | null
  ranking: number | null
  disabled: boolean
  is_private: boolean
  contact_name: string | null
  contact_email: string | null
  creator_address: string | null
  sdk: string | null
  deployed_at: string | null
  user_like: boolean
  user_dislike: boolean
  user_favorite: boolean
  /** Decorated by the destinations logic from the events domain (in-process). */
  live_event?: boolean
  /** Realtime connected users, decorated from comms-gatekeeper when requested. */
  user_count?: number
  /** 30-day unique visitors (places only; 0 for worlds), from scene-stats. */
  user_visits?: number
  /** The next upcoming event at this destination, when decorated (with=next_event). */
  next_event?: { id: string; name: string; next_start_at: string } | null
}

export type Event = {
  id: string
  name: string
  image: string | null
  image_vertical: string | null
  description: string | null
  start_at: Date
  finish_at: Date
  duration: number
  all_day: boolean
  next_start_at: Date | null
  next_finish_at: Date | null
  recurrent: boolean
  recurrent_frequency: string | null
  recurrent_setpos: number | null
  recurrent_monthday: number | null
  recurrent_weekday_mask: number
  recurrent_month_mask: number
  recurrent_interval: number
  recurrent_count: number | null
  recurrent_until: Date | null
  recurrent_dates: Date[]
  x: number
  y: number
  server: string | null
  world: boolean
  estate_id: string | null
  estate_name: string | null
  scene_name: string | null
  place_id: string | null
  world_id: string | null
  community_id: string | null
  url: string | null
  user: string
  user_name: string | null
  // Optional because they are omitted from responses for non-owners (see events serialize).
  contact?: string | null
  details?: string | null
  approved: boolean
  rejected: boolean
  approved_by: string | null
  rejected_by: string | null
  rejection_reason: string | null
  highlighted: boolean
  total_attendees: number
  latest_attendees: string[]
  categories: string[]
  schedules: string[]
  deleted_by_user: boolean
  deleted_by_admin: boolean
  deleted_by: string | null
  deleted_at: Date | null
  deleted_reason: string | null
  created_at: Date
  updated_at: Date
  // Derived, response-only (added by the events serialize; not stored columns).
  position?: number[]
  live?: boolean
  attending?: boolean
}

export type EventAttendee = {
  event_id: string
  user: string
  user_name: string | null
  created_at: Date
}

/** Authorization grants stored per wallet in profile_settings.permissions. */
export enum ProfilePermission {
  ApproveOwnEvent = 'approve_own_event',
  ApproveAnyEvent = 'approve_any_event',
  EditAnyEvent = 'edit_any_event',
  EditAnySchedule = 'edit_any_schedule',
  EditAnyProfile = 'edit_any_profile',
  TestAnyNotification = 'test_any_notification'
}

export type ProfileSettings = {
  user: string
  permissions: ProfilePermission[]
}

export type Schedule = {
  id: string
  name: string
  description: string | null
  image: string | null
  theme: string | null
  background: string[]
  active: boolean
  active_since: string
  active_until: string
  created_at: string
  updated_at: string
}
