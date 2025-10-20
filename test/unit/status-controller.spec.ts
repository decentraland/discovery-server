import { createConfigComponent } from '@well-known-components/env-config-provider'
import { statusHandler } from '../../src/controllers/handlers/status-handler'

describe('status-controller-unit', () => {
  describe('when the status handler is called', () => {
    describe('and both VERSION and IMAGE are configured', () => {
      let result: { status: number; body: string }
      let parsedBody: { status: string; timestamp: string; version: string; image: string }

      beforeEach(async () => {
        const config = createConfigComponent({
          VERSION: '1.0.0',
          IMAGE: 'decentraland/discovery-server:latest'
        })
        result = await statusHandler({ components: { config } })
        parsedBody = JSON.parse(result.body)
      })

      it('should return 200 status', () => {
        expect(result.status).toBe(200)
      })

      it('should return ok status in body', () => {
        expect(parsedBody.status).toBe('ok')
      })

      it('should return the configured version', () => {
        expect(parsedBody.version).toBe('1.0.0')
      })

      it('should return the configured image', () => {
        expect(parsedBody.image).toBe('decentraland/discovery-server:latest')
      })

      it('should include a timestamp', () => {
        expect(parsedBody.timestamp).toBeDefined()
        expect(new Date(parsedBody.timestamp).getTime()).not.toBeNaN()
      })
    })

    describe('and VERSION and IMAGE are not configured', () => {
      let result: { status: number; body: string }
      let parsedBody: { status: string; timestamp: string; version: string; image: string }

      beforeEach(async () => {
        const config = createConfigComponent({})
        result = await statusHandler({ components: { config } })
        parsedBody = JSON.parse(result.body)
      })

      it('should return 200 status', () => {
        expect(result.status).toBe(200)
      })

      it('should return ok status in body', () => {
        expect(parsedBody.status).toBe('ok')
      })

      it('should return undefined for version', () => {
        expect(parsedBody.version).toBeUndefined()
      })

      it('should return undefined for image', () => {
        expect(parsedBody.image).toBeUndefined()
      })
    })

    describe('and only VERSION is configured', () => {
      let parsedBody: { status: string; timestamp: string; version: string; image: string }

      beforeEach(async () => {
        const config = createConfigComponent({
          VERSION: '2.5.3'
        })
        const result = await statusHandler({ components: { config } })
        parsedBody = JSON.parse(result.body)
      })

      it('should return the configured version', () => {
        expect(parsedBody.version).toBe('2.5.3')
      })

      it('should return undefined for image', () => {
        expect(parsedBody.image).toBeUndefined()
      })
    })

    describe('and only IMAGE is configured', () => {
      let parsedBody: { status: string; timestamp: string; version: string; image: string }

      beforeEach(async () => {
        const config = createConfigComponent({
          IMAGE: 'myregistry/discovery:v1'
        })
        const result = await statusHandler({ components: { config } })
        parsedBody = JSON.parse(result.body)
      })

      it('should return undefined for version', () => {
        expect(parsedBody.version).toBeUndefined()
      })

      it('should return the configured image', () => {
        expect(parsedBody.image).toBe('myregistry/discovery:v1')
      })
    })
  })
})
