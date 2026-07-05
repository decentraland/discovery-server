import { test } from '../components'

test('when hitting infrastructure endpoints on a real server', function ({ components }) {
  describe('and requesting the ping endpoint', () => {
    it('should respond with a 200 and the pong body', async () => {
      const response = await components.localFetch.fetch('/ping')

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('pong')
    })
  })

  describe('and requesting the status endpoint', () => {
    it('should respond with a 200 and an ok payload', async () => {
      const response = await components.localFetch.fetch('/api/status')
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ ok: true, data: expect.objectContaining({ time: expect.any(Number) }) })
    })
  })

  describe('and requesting an unknown route', () => {
    it('should respond with a 404', async () => {
      const response = await components.localFetch.fetch('/does-not-exist')

      expect(response.status).toBe(404)
    })
  })
})
