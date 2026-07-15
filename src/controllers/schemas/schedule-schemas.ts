/**
 * JSON schemas for the schedule create/update bodies (legacy Schedule Ajv parity): name
 * <=50, description/image/background items <=255, a curated theme enum, and string dates.
 * `additionalProperties: true` keeps it lenient; create requires the core fields.
 */
const SCHEDULE_FIELDS = {
  name: { type: 'string', maxLength: 50 },
  description: { type: ['string', 'null'], maxLength: 255 },
  image: { type: ['string', 'null'], maxLength: 255 },
  theme: { enum: ['mvmf_2022', 'mvfw_2023', 'pride_2023', null] },
  background: { type: 'array', items: { type: 'string', maxLength: 255 } },
  active: { type: 'boolean' },
  active_since: { type: 'string' },
  active_until: { type: 'string' }
} as const

export const createScheduleSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['name', 'active_since', 'active_until'],
  properties: SCHEDULE_FIELDS
}

export const updateScheduleSchema = {
  type: 'object',
  additionalProperties: true,
  properties: SCHEDULE_FIELDS
}
