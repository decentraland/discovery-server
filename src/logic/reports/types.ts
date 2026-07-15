export type ReportUpload = { url: string; key: string }

export interface IReportsComponent {
  /** Mint a presigned URL the client uses to upload a content-moderation report. */
  createReportUploadUrl(user: string): Promise<ReportUpload>
}
