import { classifyEntity } from '../../scripts/etl/migrate'

describe('when classifying a legacy interaction entity id', () => {
  describe('and the id is a padded UUID', () => {
    it('should classify it as a place', () => {
      expect(classifyEntity('123e4567-e89b-12d3-a456-426614174000  ')).toBe('place')
    })
  })

  describe('and the id is a world name', () => {
    it('should classify it as a world', () => {
      expect(classifyEntity('my-world.dcl.eth')).toBe('world')
    })
  })
})
