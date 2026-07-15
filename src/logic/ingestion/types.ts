import type { CatalystDeploymentEvent } from '@dcl/schemas'

export type IngestionResult = { processed: boolean; placeId?: string; reason?: string }

export type WorldDeploymentEventMessage = {
  entity?: { entityId?: string }
  contentServerUrls?: string[]
  timestamp?: number
}
export type WorldSettingsChangedMetadata = {
  worldName: string
  title?: string
  description?: string
  contentRating?: string
  skyboxTime?: number | null
  categories?: string[]
  singlePlayer?: boolean
  showInPlaces?: boolean
  thumbnailUrl?: string
  accessType?: string
}
export type WorldScenesUndeploymentMetadata = {
  worldName: string
  scenes?: Array<{ entityId: string; baseParcel: string }>
}
export type WorldUndeploymentMetadata = { worldName: string }
export type WorldEvent<M> = { metadata: M; timestamp?: number }

export interface IIngestionComponent {
  /** Process a Catalyst scene deployment: upsert the genesis place (or world scene if worldConfiguration). */
  processCatalystDeployment(event: CatalystDeploymentEvent): Promise<IngestionResult>
  /** Process a world scene deployment (entityId only): fetch the entity, then upsert the world place. */
  processWorldDeployment(event: WorldDeploymentEventMessage): Promise<IngestionResult>
  /** Process a world settings-changed event: upsert the world (owner refreshed from the subgraphs). */
  processWorldSettingsChanged(event: WorldEvent<WorldSettingsChangedMetadata>): Promise<IngestionResult>
  /** Process a world scenes-undeployment event: disable the world's undeployed places. */
  processWorldScenesUndeployment(event: WorldEvent<WorldScenesUndeploymentMetadata>): Promise<IngestionResult>
  /** Process a full world undeployment: disable every place of the world. */
  processWorldUndeployment(event: WorldEvent<WorldUndeploymentMetadata>): Promise<IngestionResult>
}
