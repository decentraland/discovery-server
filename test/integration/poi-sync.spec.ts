import SQL from 'sql-template-strings'
import { test } from '../components'

test('when reconciling the POI category', function ({ components }) {
  describe('and a place sits at a POI position', () => {
    let poiId: string
    let formerPoiId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM place_categories`)
      await components.pg.query(SQL`DELETE FROM places`)
      const poi = await components.placesRepository.insert(components.pg, { title: 'POI', base_position: '0,0' })
      poiId = poi.id
      const formerPoi = await components.placesRepository.insert(components.pg, {
        title: 'Former POI',
        base_position: '5,5',
        categories: ['poi']
      })
      formerPoiId = formerPoi.id
      // Former POI also has the pivot row that reconciliation must remove.
      await components.pg.query(
        SQL`INSERT INTO place_categories (category_id, place_id) VALUES ('poi', ${formerPoiId})`
      )
    })

    it('should add the poi category to the current POI place', async () => {
      await components.pg.withTransaction((tx) => components.categoriesRepository.reconcilePoiCategory(tx, ['0,0']))
      const place = await components.pg.query<{ categories: string[] }>(
        SQL`SELECT categories FROM places WHERE id = ${poiId}`
      )

      expect(place.rows[0].categories).toContain('poi')
    })

    it('should remove the poi category from places no longer listed', async () => {
      await components.pg.withTransaction((tx) => components.categoriesRepository.reconcilePoiCategory(tx, ['0,0']))
      const place = await components.pg.query<{ categories: string[] }>(
        SQL`SELECT categories FROM places WHERE id = ${formerPoiId}`
      )
      const pivot = await components.pg.query(SQL`SELECT 1 FROM place_categories WHERE place_id = ${formerPoiId}`)

      expect(place.rows[0].categories).not.toContain('poi')
      expect(pivot.rowCount).toBe(0)
    })
  })
})
