/** Per-realm live occupancy for a scene, as surfaced by realm-provider `/hot-scenes`. */
export type RealmDetail = { serverName: string; url: string; usersCount: number }

export type HotScene = {
  id: string
  name: string
  baseCoords: [number, number]
  usersTotalCount: number
  parcels: [number, number][]
  realms?: RealmDetail[]
}

export interface IHotScenesComponent {
  /** Realtime user count for the scene at a base position (0 if none/unconfigured). */
  getUserCount(basePosition: string): Promise<number>
  /** Per-realm live occupancy for the scene at a base position (the `realms_detail` decoration). */
  getRealms(basePosition: string): Promise<RealmDetail[]>
  /** Base positions ("x,y") of scenes that currently have users — drives most_active ordering. */
  getActivePositions(): Promise<string[]>
  /** Force a refresh of the cached hot-scenes snapshot (used by the refresh cron). */
  refresh(): Promise<void>
}
