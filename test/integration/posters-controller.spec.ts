import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { test } from '../components'

test('when uploading event posters', function ({ components }) {
  describe('and the request is not signed', () => {
    it('should reject the upload', async () => {
      const response = await components.localFetch.fetch('/api/poster', { method: 'POST' })

      expect(response.status).toBe(400)
    })
  })

  describe('and a signed request uploads a small png', () => {
    let identity: Awaited<ReturnType<typeof getIdentity>>

    beforeEach(async () => {
      identity = await getIdentity()
    })

    it('should accept the poster and return a url', async () => {
      const path = '/api/poster'
      const headers = getSignedAuthHeaders('POST', path, {}, identity)
      const form = new FormData()
      // 1x1 transparent PNG.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      )
      form.append('poster', new Blob([png], { type: 'image/png' }), 'poster.png')

      const response = await components.localFetch.fetch(path, { method: 'POST', headers, body: form })
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(typeof body.data.url).toBe('string')
    })
  })
})
