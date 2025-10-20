import { test } from '../components'

test('integration tests for /status endpoint', function ({ components }) {
  describe('when requesting the /status endpoint', () => {
    let response: Awaited<ReturnType<typeof components.localFetch.fetch>>
    let responseBody: { status: string; timestamp: string; version?: string; image?: string }

    beforeEach(async () => {
      const { localFetch } = components
      response = await localFetch.fetch('/status')
      responseBody = await response.json()
    })

    it('should respond with 200 status', () => {
      expect(response.status).toEqual(200)
    })

    it('should respond with ok status', () => {
      expect(responseBody.status).toBe('ok')
    })

    it('should include a timestamp', () => {
      expect(responseBody.timestamp).toBeDefined()
      expect(new Date(responseBody.timestamp).getTime()).not.toBeNaN()
    })

    it('should return valid JSON', () => {
      expect(responseBody).toBeInstanceOf(Object)
      expect(responseBody.status).toBeDefined()
    })
  })

  describe('when calling /status multiple times', () => {
    let firstResponse: { timestamp: string }
    let secondResponse: { timestamp: string }

    beforeEach(async () => {
      const { localFetch } = components

      const r1 = await localFetch.fetch('/status')
      firstResponse = await r1.json()

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10))

      const r2 = await localFetch.fetch('/status')
      secondResponse = await r2.json()
    })

    it('should return different timestamps', () => {
      expect(firstResponse.timestamp).not.toEqual(secondResponse.timestamp)
    })
  })
})
