import { createConfigComponent } from '@well-known-components/env-config-provider'
import { statusHandler } from '../../src/controllers/handlers/status-handler'

describe('status-controller-unit', () => {
  describe('when the status handler is called', () => {
    describe('and both CURRENT_VERSION and COMMIT_HASH are configured', () => {
      let result: { status: number; body: string }
      let parsedBody: { status: string; timestamp: string; version: string; commitHash: string }

      beforeEach(async () => {
        const config = createConfigComponent({
          CURRENT_VERSION: '1.0.0',
          COMMIT_HASH: 'abc123'
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

      it('should return the configured commit hash', () => {
        expect(parsedBody.commitHash).toBe('abc123')
      })

      it('should include a timestamp', () => {
        expect(parsedBody.timestamp).toBeDefined()
        expect(new Date(parsedBody.timestamp).getTime()).not.toBeNaN()
      })
    })

    describe('and CURRENT_VERSION and COMMIT_HASH are not configured', () => {
      let result: { status: number; body: string }
      let parsedBody: { status: string; timestamp: string; version: string; commitHash: string }

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

      it('should return undefined for commitHash', () => {
        expect(parsedBody.commitHash).toBeUndefined()
      })
    })

    describe('and only CURRENT_VERSION is configured', () => {
      let parsedBody: { status: string; timestamp: string; version: string; commitHash: string }

      beforeEach(async () => {
        const config = createConfigComponent({
          CURRENT_VERSION: '2.5.3'
        })
        const result = await statusHandler({ components: { config } })
        parsedBody = JSON.parse(result.body)
      })

      it('should return the configured version', () => {
        expect(parsedBody.version).toBe('2.5.3')
      })

      it('should return undefined for commitHash', () => {
        expect(parsedBody.commitHash).toBeUndefined()
      })
    })

    describe('and only COMMIT_HASH is configured', () => {
      let parsedBody: { status: string; timestamp: string; version: string; commitHash: string }

      beforeEach(async () => {
        const config = createConfigComponent({
          COMMIT_HASH: 'def456'
        })
        const result = await statusHandler({ components: { config } })
        parsedBody = JSON.parse(result.body)
      })

      it('should return undefined for version', () => {
        expect(parsedBody.version).toBeUndefined()
      })

      it('should return the configured commitHash', () => {
        expect(parsedBody.commitHash).toBe('def456')
      })
    })
  })
})
