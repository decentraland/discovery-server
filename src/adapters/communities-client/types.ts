export type Community = { id: string; name: string; ownerAddress: string }

/** A single community's public metadata, used to build the EVENT_CREATED fan-out. */
export type CommunityDetails = { id: string; name: string; thumbnailRaw?: string }

export interface ICommunitiesClient {
  /** Whether the communities API is configured (URL present). */
  readonly enabled: boolean
  /** Communities the given wallet owns or moderates (empty on unconfigured/error). */
  getManagedCommunities(address: string): Promise<Community[]>
  /** A single community's metadata, or null when unconfigured / not found / on error. */
  getCommunity(communityId: string): Promise<CommunityDetails | null>
  /** Member wallet addresses of a community, paginated (empty on unconfigured/error). */
  getCommunityMembers(communityId: string): Promise<string[]>
}
