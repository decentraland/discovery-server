export type UploadUrlOptions = {
  contentType?: string
  /** Presigned URL lifetime in seconds (default 300). */
  expiresIn?: number
}

export interface IStorageComponent {
  /** A presigned PUT URL the client uses to upload an object directly to the bucket. */
  getUploadUrl(key: string, options?: UploadUrlOptions): Promise<string>
  /** Upload an object server-side (used for posters). */
  uploadObject(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void>
  /** The public URL an uploaded object is served from. */
  publicUrl(key: string): string
}
