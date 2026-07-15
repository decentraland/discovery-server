/** The subset of a Catalyst/worlds entity the ingestion path reads. */
export type SceneEntity = {
  type?: string
  pointers?: string[]
  timestamp?: number
  content?: Array<{ file: string; hash: string }>
  metadata?: Record<string, unknown>
}

export interface ICatalystClient {
  /**
   * The `"x,y"` parcel positions a wallet owns or operates (owned + estate-expanded
   * + rented), from the Catalyst `lands-permissions` lambda. Empty when unconfigured
   * or on error.
   */
  getOperatedPositions(address: string): Promise<string[]>
  /** The wallet's profile display name from the `profiles` lambda; null when none/unconfigured/error. */
  getProfileName(address: string): Promise<string | null>
  /**
   * Fetch a deployed entity by id from a content server (`/contents/:id`), for events that
   * carry only an entityId (world deployments). Returns null on any error/unconfigured input.
   */
  getEntityById(contentServerUrl: string, entityId: string): Promise<SceneEntity | null>
}
