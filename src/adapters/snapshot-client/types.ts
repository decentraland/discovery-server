export interface ISnapshotClient {
  /** Snapshot voting power for a wallet (0 on invalid address or any error). */
  getVotingPower(address: string): Promise<number>
}
