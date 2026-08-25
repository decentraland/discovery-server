import SQL from 'sql-template-strings'
import { Authenticator } from '@dcl/crypto'
import { AUTH_CHAIN_HEADER_PREFIX, AUTH_METADATA_HEADER, AUTH_TIMESTAMP_HEADER } from '@dcl/crypto-middleware'
import { getIdentity, getSignedAuthHeaders } from '@dcl/test-helpers'
import { test } from '../components'

const PATH = '/api/profiles/me/settings'
const SIGNED_METADATA = { signer: 'decentraland-kernel-scene' }
const DELIVERED_METADATA = JSON.stringify({ signer: 'Decentraland-Kernel-Scene' })
const RESPELLED_KEY_METADATA = { Signer: 'decentraland-kernel-scene' }

/**
 * Signs the payload the way @dcl/crypto-middleware >= 6 actually builds it: the method, path and
 * timestamp lowercased, the metadata JSON joined verbatim.
 *
 * `getSignedAuthHeaders` from @dcl/test-helpers lowercases the whole joined string, which is the
 * pre-6.0.0 format. For all-lowercase metadata the two are byte-identical, so it works everywhere
 * else in this suite — but it cannot express a re-spelled key: it would sign `{"signer":...}` while
 * delivering `{"Signer":...}`, and the request would die at signature verification instead of
 * reaching the metadata gate under test. Signed here so the case below exercises the strict path.
 */
function getStrictlySignedAuthHeaders(
  method: string,
  path: string,
  metadata: Record<string, unknown>,
  identity: Awaited<ReturnType<typeof getIdentity>>
): Record<string, string> {
  const headers: Record<string, string> = {}
  const timestamp = Date.now()
  const metadataJSON = JSON.stringify(metadata)
  const payload = [method.toLowerCase(), path.toLowerCase(), timestamp.toString(), metadataJSON].join(':')

  const chain = Authenticator.signPayload(
    {
      ephemeralIdentity: identity.ephemeralIdentity,
      expiration: new Date(),
      authChain: identity.authChain.authChain
    },
    payload
  )

  chain.forEach((link, index) => {
    headers[`${AUTH_CHAIN_HEADER_PREFIX}${index}`] = JSON.stringify(link)
  })
  headers[AUTH_TIMESTAMP_HEADER] = timestamp.toString()
  headers[AUTH_METADATA_HEADER] = metadataJSON

  return headers
}

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

  describe('and the scene signer is named under a re-spelled `Signer` key', () => {
    it('should reject it as a scene request rather than read the field as absent', async () => {
      // Distinct from the mixed-case *value* above: the value is already canonical here and the
      // *key* is re-spelled. It is signed that way rather than rewritten after signing, so the
      // signature covers the delivered bytes verbatim and the request is valid on the current 6.x
      // payload — the strict path, not the legacy one.
      //
      // A predicate reading the exact key sees no `signer` and treats the field as absent, so the
      // gate answered "allowed" for metadata that visibly names the signer it exists to refuse and
      // the scene request was served as an ordinary user-signed one. `rejectIfSigner` now treats a
      // key that case-folds to `signer` without being spelled exactly that as a rejection.
      const headers = getStrictlySignedAuthHeaders('GET', PATH, RESPELLED_KEY_METADATA, identity)

      const response = await components.localFetch.fetch(PATH, { headers })

      // Asserted before the body is parsed: unguarded this is a 200 carrying the caller's settings.
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/^Invalid metadata content: /)
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
