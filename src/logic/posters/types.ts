export type PosterFile = { value: Buffer; mimeType?: string }

/** Legacy poster upload response shape. */
export type PosterUpload = { filename: string; url: string; size: number; type: string }

export interface IPostersComponent {
  /** Validate and store a horizontal poster; returns its filename/url/size/type. */
  uploadHorizontal(file: PosterFile | undefined): Promise<PosterUpload>
  /** Validate and store a vertical poster (no gif); returns its filename/url/size/type. */
  uploadVertical(file: PosterFile | undefined): Promise<PosterUpload>
}
