import { isPlaceId, resolveEntityType } from '../../src/logic/entity-id'

describe('when resolving an entity id', () => {
  describe('and the id is a uuid', () => {
    it('should be recognized as a place id', () => {
      expect(isPlaceId('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    })

    it('should resolve to the place entity type', () => {
      expect(resolveEntityType('123e4567-e89b-12d3-a456-426614174000')).toBe('place')
    })
  })

  describe('and the id is a world name', () => {
    it('should not be recognized as a place id', () => {
      expect(isPlaceId('my-world.dcl.eth')).toBe(false)
    })

    it('should resolve to the world entity type', () => {
      expect(resolveEntityType('my-world.dcl.eth')).toBe('world')
    })
  })
})
