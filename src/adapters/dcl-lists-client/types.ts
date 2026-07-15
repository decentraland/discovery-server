export interface IDclListsClient {
  /** Current Point-of-Interest base positions (empty when unconfigured/on error). */
  getPois(): Promise<string[]>
}
