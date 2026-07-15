export interface IWorldsLiveDataComponent {
  /** Realtime user count in a world (0 if none/unconfigured). */
  getUserCount(worldName: string): Promise<number>
  /** Force a refresh of the cached worlds live-data snapshot (used by the refresh cron). */
  refresh(): Promise<void>
}
