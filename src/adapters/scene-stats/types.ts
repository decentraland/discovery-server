export interface ISceneStatsComponent {
  /** 30-day unique-visitor count for the scene at a base position (0 if none/unconfigured). */
  getVisits(basePosition: string): Promise<number>
  /**
   * 30-day visits for a multi-parcel scene: the count for the first of `positions` that has
   * stats (base position first). Legacy parity — stats may be keyed on a non-base parcel.
   */
  getVisitsForPositions(positions: string[]): Promise<number>
  /** Force a refresh of the cached scene-stats snapshot. */
  refresh(): Promise<void>
}
