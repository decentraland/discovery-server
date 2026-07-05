/**
 * Shared domain DTOs served across the API. Grown per domain as phases land.
 */

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
