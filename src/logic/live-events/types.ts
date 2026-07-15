export type NextEvent = { id: string; name: string; next_start_at: string }
export type LiveEntityIds = { placeIds: string[]; worldIds: string[] }

export interface ILiveEventsComponent {
  /** Place/world ids that currently have a live event (cached snapshot). */
  getLiveEntityIds(): Promise<LiveEntityIds>
  /** Earliest upcoming event per place/world id, as a map (cached snapshot). */
  getNextEventMap(): Promise<Record<string, NextEvent>>
  /** Force a refresh of the cached snapshots. */
  refresh(): Promise<void>
}
