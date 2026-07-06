import { LRUCache } from 'lru-cache'
import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IFetchComponent } from '@dcl/core-commons'

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 10_000

// DCL Snapshot voting-power strategies, carried over verbatim from the places service.
const STRATEGIES = [
  {
    name: 'multichain',
    network: '1',
    params: {
      name: 'multichain',
      graphs: { 137: 'subgraph.decentraland.org/blocks-matic-mainnet' },
      symbol: 'MANA',
      strategies: [
        {
          name: 'erc20-balance-of',
          params: { address: '0x0f5d2fb29fb7d3cfee444a200298f468908cc942', decimals: 18 },
          network: '1'
        },
        {
          name: 'erc20-balance-of',
          params: { address: '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4', decimals: 18 },
          network: '137'
        }
      ]
    }
  },
  {
    name: 'erc20-balance-of',
    network: '1',
    params: { symbol: 'WMANA', address: '0xfd09cf7cfffa9932e33668311c4777cb9db3c9be', decimals: 18 }
  },
  {
    name: 'erc721-with-multiplier',
    network: '1',
    params: { symbol: 'LAND', address: '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d', multiplier: 2000 }
  },
  {
    name: 'decentraland-estate-size',
    network: '1',
    params: { symbol: 'ESTATE', address: '0x959e104e1a4db6317fa58f8295f586e1a978c297', multiplier: 2000 }
  },
  {
    name: 'erc721-with-multiplier',
    network: '1',
    params: { symbol: 'NAMES', address: '0x2a187453064356c898cae034eaed119e1663acb8', multiplier: 100 }
  }
]

export interface ISnapshotClient {
  /** Snapshot voting power for a wallet (0 on invalid address or any error). */
  getVotingPower(address: string): Promise<number>
}

/**
 * Snapshot voting-power client. Posts a `get_vp` request to score.snapshot.org
 * through the traced fetcher and caches results per address (10 min TTL) to avoid
 * hammering on every like. Always degrades to 0 on error — VP only affects
 * like_rate/like_score weighting, never the like count itself.
 */
export async function createSnapshotClient(
  components: Pick<
    { config: IConfigComponent; logs: ILoggerComponent; fetcher: IFetchComponent },
    'config' | 'logs' | 'fetcher'
  >
): Promise<ISnapshotClient> {
  const { config, logs, fetcher } = components
  const logger = logs.getLogger('snapshot-client')

  const scoreUrl = (await config.getString('SNAPSHOT_SCORE_URL')) ?? 'https://score.snapshot.org/'
  const space = (await config.getString('SNAPSHOT_SPACE')) ?? 'snapshot.dcl.eth'
  const cache = new LRUCache<string, number>({ max: CACHE_MAX, ttl: CACHE_TTL_MS })

  async function getVotingPower(address: string): Promise<number> {
    if (!ETH_ADDRESS_RE.test(address)) return 0
    const wallet = address.toLowerCase()
    const cached = cache.get(wallet)
    if (cached !== undefined) return cached

    try {
      const response = await fetcher.fetch(scoreUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'get_vp',
          params: { network: '1', address: wallet, strategies: STRATEGIES, space, delegation: false }
        })
      })
      const body = (await response.json()) as { result?: { vp?: number } }
      const vp = Math.trunc(body?.result?.vp ?? 0)
      cache.set(wallet, vp)
      return vp
    } catch (error: any) {
      logger.warn(`Failed to load voting power for ${wallet}: ${error?.message ?? String(error)}`)
      return 0
    }
  }

  return { getVotingPower }
}
