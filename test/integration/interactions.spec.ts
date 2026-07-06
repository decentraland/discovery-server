import SQL from 'sql-template-strings'
import { test } from '../components'

test('when recording interactions against a real database', function ({ components }) {
  describe('and a user likes a world using a mixed-case id', () => {
    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM user_likes`)
      await components.pg.query(SQL`DELETE FROM worlds`)
      await components.worldsRepository.upsert(components.pg, {
        id: 'my-world.dcl.eth',
        world_name: 'my-world.dcl.eth',
        show_in_places: true
      })
      await components.interactions.setLike({
        entityId: 'My-World.dcl.eth',
        entityType: 'world',
        user: '0xAAA',
        userActivity: 200,
        like: true
      })
    })

    it('should update the world like counters despite the id casing', async () => {
      const world = await components.worldsRepository.findByIdWithAggregates(components.pg, 'my-world.dcl.eth', '0xaaa')

      expect(world).toEqual(expect.objectContaining({ likes: 1, user_like: true }))
    })
  })

  describe('and multiple active users like and dislike a place', () => {
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM user_likes`)
      await components.pg.query(SQL`DELETE FROM places`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '0,0' })
      placeId = place.id

      await components.interactions.setLike({
        entityId: placeId,
        entityType: 'place',
        user: '0xAAA',
        userActivity: 200,
        like: true
      })
      await components.interactions.setLike({
        entityId: placeId,
        entityType: 'place',
        user: '0xBBB',
        userActivity: 200,
        like: true
      })
      await components.interactions.setLike({
        entityId: placeId,
        entityType: 'place',
        user: '0xCCC',
        userActivity: 200,
        like: false
      })
    })

    it('should update the denormalized like and dislike counts', async () => {
      const place = await components.placesRepository.findByIdWithAggregates(components.pg, placeId)

      expect(place).toEqual(expect.objectContaining({ likes: 2, dislikes: 1 }))
    })

    it('should compute a like_rate of two thirds', async () => {
      const place = await components.placesRepository.findByIdWithAggregates(components.pg, placeId)

      expect(place!.like_rate).toBeCloseTo(2 / 3, 5)
    })

    it('should compute a non-null Wilson like_score', async () => {
      const place = await components.placesRepository.findByIdWithAggregates(components.pg, placeId)

      expect(place!.like_score).toBeGreaterThan(0)
    })

    it('should reflect a cleared reaction by lowering the like count', async () => {
      await components.interactions.setLike({
        entityId: placeId,
        entityType: 'place',
        user: '0xAAA',
        userActivity: 200,
        like: null
      })
      const place = await components.placesRepository.findByIdWithAggregates(components.pg, placeId)

      expect(place).toEqual(expect.objectContaining({ likes: 1, dislikes: 1 }))
    })
  })

  describe('and a user favorites then unfavorites a place', () => {
    let placeId: string

    beforeEach(async () => {
      await components.pg.query(SQL`DELETE FROM user_favorites`)
      await components.pg.query(SQL`DELETE FROM places`)
      const place = await components.placesRepository.insert(components.pg, { title: 'Plaza', base_position: '1,1' })
      placeId = place.id
    })

    it('should increment the favorites count when favorited', async () => {
      await components.interactions.setFavorite({
        entityId: placeId,
        entityType: 'place',
        user: '0xAAA',
        favorite: true
      })
      const place = await components.placesRepository.findByIdWithAggregates(components.pg, placeId)

      expect(place!.favorites).toBe(1)
    })

    it('should decrement the favorites count back to zero when unfavorited', async () => {
      await components.interactions.setFavorite({
        entityId: placeId,
        entityType: 'place',
        user: '0xAAA',
        favorite: true
      })
      await components.interactions.setFavorite({
        entityId: placeId,
        entityType: 'place',
        user: '0xAAA',
        favorite: false
      })
      const place = await components.placesRepository.findByIdWithAggregates(components.pg, placeId)

      expect(place!.favorites).toBe(0)
    })
  })
})
