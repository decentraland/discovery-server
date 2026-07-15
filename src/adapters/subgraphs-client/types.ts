export interface ISubgraphsClient {
  /**
   * On-chain owner address of a world name. DCL names (`*.dcl.eth`) resolve via the
   * Marketplace subgraph; external ENS names via the ENS subgraph. Returns undefined
   * when unconfigured or on any error (ingestion never blocks on the subgraph).
   */
  getNameOwner(worldName: string): Promise<string | undefined>
}
