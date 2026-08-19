import SQL from 'sql-template-strings'
import { AUTH_METADATA_HEADER } from '@dcl/crypto-middleware'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { test } from '../components'

const PATH = '/api/profiles/me/settings'
const SIGNED_METADATA = { signer: 'decentraland-kernel-scene' }
const DELIVERED_METADATA = JSON.stringify({ signer: 'Decentraland-Kernel-Scene' })

test('when a request carries a scene signer', function ({ components }) {
  let identity: Awaited<ReturnType<typeof getIdentity>>

  beforeEach(async () => {
    await components.pg.query(SQL`DELETE FROM profile_settings`)
    identity = await getIdentity()
  })

  describe('and the canonical signer was signed but a mixed-case spelling is delivered', () => {
    it('should reject the request rather than let it past the scene gate', async () => {
      // Overwriting the metadata header after signing is the attack, not a mock: nothing here
      // weakens the signature. Two independent things now refuse it. `rejectIfSigner` runs before
      // any crypto and refuses a `signer` that is present but not canonical rather than comparing
      // it, so the request never reaches signature verification — which would have failed too,
      // since 6.0.0 signs the metadata bytes verbatim and the delivered bytes differ.
      const headers = getSignedAuthHeaders('GET', PATH, SIGNED_METADATA, identity)
      headers[AUTH_METADATA_HEADER] = DELIVERED_METADATA

      const response = await components.localFetch.fetch(PATH, { headers })
      const body = await response.json()

      // Without the gate the mixed-case spelling would fail a strict `!== 'decentraland-kernel-scene'`
      // check in signed-fetch.ts, so the scene request would read as a directly user-signed one.
      expect(response.status).toBe(400)
      // The metadata is echoed back truncated at 64 characters, so match the prefix.
      expect(body.error).toMatch(/^Invalid metadata content: /)
    })
  })

  describe('and the canonical signer is delivered exactly as signed', () => {
    it('should reject it as a scene request', async () => {
      const headers = getSignedAuthHeaders('GET', PATH, SIGNED_METADATA, identity)

      const response = await components.localFetch.fetch(PATH, { headers })
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/^Invalid metadata content: /)
    })
  })

  describe('and the request carries no signer at all', () => {
    it('should authenticate normally and reach the handler', async () => {
      const headers = getSignedAuthHeaders('GET', PATH, {}, identity)

      const response = await components.localFetch.fetch(PATH, { headers })
      const body = await response.json()

      // Ordinary user traffic must be untouched by the guard: this gets all the way to the handler,
      // which returns the empty defaults for a wallet with no settings row.
      expect(response.status).toBe(200)
      expect(body.data).toEqual(expect.objectContaining({ permissions: [] }))
    })
  })
})
