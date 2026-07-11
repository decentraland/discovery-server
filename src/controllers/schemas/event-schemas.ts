import { AllowedInputFrequencies } from '../../logic/recurrence'

/**
 * JSON schemas for the legacy event create/update bodies, validated by
 * `@dcl/schema-validator` before the handler runs. Types and numeric bounds match the
 * legacy Ajv `newEventSchema` (interval 1..1000, count 0..1000, setpos >= -1, masks >= 0,
 * x/y in [-170,170]); this closes the untyped-body gap that let a bad recurrence value
 * reach rrule. `additionalProperties: true` keeps it lenient (e.g. the update `actor`
 * field, and forward-compatible extras), and only `name`/`start_at` are required so the
 * discovery enhancements (deriving duration from `finish_at`, defaulting x/y) still work.
 */
const EVENT_FIELDS = {
  name: { type: 'string', maxLength: 150 },
  description: { type: ['string', 'null'], maxLength: 5000 },
  image: { type: ['string', 'null'] },
  image_vertical: { type: ['string', 'null'] },
  contact: { type: ['string', 'null'] },
  details: { type: ['string', 'null'] },
  url: { type: ['string', 'null'] },
  start_at: { type: 'string' },
  finish_at: { type: 'string' },
  duration: { type: 'number', minimum: 0 },
  all_day: { type: 'boolean' },
  x: { type: 'number', minimum: -170, maximum: 170 },
  y: { type: 'number', minimum: -170, maximum: 170 },
  server: { type: ['string', 'null'] },
  world: { type: 'boolean' },
  estate_id: { type: ['string', 'null'] },
  estate_name: { type: ['string', 'null'] },
  scene_name: { type: ['string', 'null'] },
  community_id: { type: ['string', 'null'] },
  categories: { type: 'array', items: { type: 'string' } },
  schedules: { type: 'array', items: { type: 'string' } },
  user_name: { type: ['string', 'null'] },
  recurrent: { type: 'boolean' },
  recurrent_frequency: { enum: [...AllowedInputFrequencies, null] },
  recurrent_interval: { type: 'integer', minimum: 1, maximum: 1000 },
  recurrent_count: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
  recurrent_until: { type: ['string', 'null'] },
  recurrent_weekday_mask: { type: 'integer', minimum: 0 },
  recurrent_month_mask: { type: 'integer', minimum: 0 },
  recurrent_setpos: { type: ['integer', 'null'], minimum: -1 },
  recurrent_monthday: { type: ['integer', 'null'] }
} as const

export const createEventSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['name', 'start_at'],
  properties: EVENT_FIELDS
}

export const updateEventSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ...EVENT_FIELDS,
    // Moderation + admin fields the update path also accepts.
    approved: { type: 'boolean' },
    rejected: { type: 'boolean' },
    rejection_reason: { type: ['string', 'null'] },
    highlighted: { type: 'boolean' },
    deleted_by_user: { type: 'boolean' },
    deleted_by_admin: { type: 'boolean' },
    deleted_reason: { type: ['string', 'null'] },
    actor: { type: 'string' }
  }
}
