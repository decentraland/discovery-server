import SQL from 'sql-template-strings'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { test } from '../components'

test('when moderating places and worlds', function ({ components }) {
  describe('and an operator changes a place content rating via the component', () => {
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM content_ratings`)
      await components.pg.query(SQL`DELETE FROM places`)
      const place = await components.placesRepository.insert(components.pg, {
        title: 'Plaza',
        base_position: '0,0',
        content_rating: 'PR'
      })
      placeId = place.id
      await components.moderation.setPlaceRating(placeId, 'R', '0xMODERATOR', 'too mature')
    })

    it('should update the place content rating', async () => {
      const place = await components.placesRepository.findByIdWithAggregates(components.pg, placeId)

      expect(place!.content_rating).toBe('R')
    })

    it('should append a content-ratings audit row with the previous rating', async () => {
      const result = await components.pg.query<{ original_rating: string; update_rating: string; moderator: string }>(
        SQL`SELECT original_rating, update_rating, moderator FROM content_ratings WHERE entity_id = ${placeId}`
      )

      expect(result.rows[0]).toEqual(
        expect.objectContaining({ original_rating: 'PR', update_rating: 'R', moderator: '0xmoderator' })
      )
    })
  })

  describe('and disabling a place via the component', () => {
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '1,1' })
      placeId = place.id
      await components.moderation.setPlaceDisabled(placeId, true)
    })

    it('should mark the place disabled with a timestamp and reason', async () => {
      const result = await components.pg.query<{ disabled: boolean; disabled_reason: string; disabled_at: Date }>(
        SQL`SELECT disabled, disabled_reason, disabled_at FROM places WHERE id = ${placeId}`
      )

      expect(result.rows[0].disabled).toBe(true)
      expect(result.rows[0].disabled_reason).toBe('moderation')
      expect(result.rows[0].disabled_at).not.toBeNull()
    })
  })

  describe('and a non-admin signed request hits a moderation route', () => {
    let placeId: string
    let identity: Awaited<ReturnType<typeof getIdentity>>

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM places`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '2,2' })
      placeId = place.id
      identity = await getIdentity()
    })

    it('should be forbidden with a 403', async () => {
      const path = `/api/places/${placeId}/rating`
      const headers = getSignedAuthHeaders('PUT', path, {}, identity)
      const response = await components.localFetch.fetch(path, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ rating: 'R' })
      })

      expect(response.status).toBe(403)
    })
  })
})
