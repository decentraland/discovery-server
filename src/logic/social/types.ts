export interface ISocialComponent {
  /** OG/Twitter meta HTML for a place, by id or by `x,y` position. */
  getPlaceMetaHtml(params: { id?: string; position?: string }): Promise<string>
  /** OG/Twitter meta HTML for a world, by id or name. */
  getWorldMetaHtml(params: { id?: string; name?: string }): Promise<string>
}
