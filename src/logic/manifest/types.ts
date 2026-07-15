export type ManifestResult = { published: boolean; occupied: number; empty: number }

export interface IManifestComponent {
  /**
   * Rebuild the Genesis City manifest (roads / occupied / empty parcels) from the
   * occupied place positions and publish `WorldManifest.json`. A no-op when the
   * public bucket is not configured.
   */
  rebuild(): Promise<ManifestResult>
}
