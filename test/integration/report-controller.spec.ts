import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { test } from '../components'

test('when requesting a content-moderation report url', function ({ components }) {
  describe('and the request is signed', () => {
    let identity: Awaited<ReturnType<typeof getIdentity>>

    beforeEach(async () => {
      identity = await getIdentity()
    })

    it('should return a presigned upload url pointing at a report key', async () => {
      const path = '/api/report'
      const headers = getSignedAuthHeaders('POST', path, {}, identity)
      const response = await components.localFetch.fetch(path, { method: 'POST', headers })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(typeof body.data.url).toBe('string')
      expect(body.data.url).toContain('reports/')
    })
  })

  describe('and the request is not signed', () => {
    it('should reject the request', async () => {
      const response = await components.localFetch.fetch('/api/report', { method: 'POST' })

      expect(response.status).toBe(400)
    })
  })
})
