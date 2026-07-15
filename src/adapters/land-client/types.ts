export type LandTile = { estateId?: string | null; name?: string | null }

export interface ILandClient {
  /** The Land tile at a parcel (estate id + name), or null when unconfigured/unreachable. */
  getTile(x: number, y: number): Promise<LandTile | null>
  /** Map-image URL for an estate. */
  getEstateImage(estateId: string): string
  /** Map-image URL for a parcel. */
  getParcelImage(x: number, y: number): string
}
