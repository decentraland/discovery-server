export interface ICommsGatekeeperClient {
  /** Connected wallet addresses in the scene at a base position (empty when unconfigured/on error). */
  getSceneParticipants(basePosition: string): Promise<string[]>
  /** Connected wallet addresses in a world (empty when unconfigured/on error). */
  getWorldParticipants(worldName: string): Promise<string[]>
}
