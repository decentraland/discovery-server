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
}

export type AggregateWorld = World & {
  user_like: boolean
  user_dislike: boolean
  user_favorite: boolean
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
