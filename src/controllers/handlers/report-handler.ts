import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import { UnauthorizedError } from '../../types/errors'

/**
 * Legacy `POST /api/report` — returns a presigned S3 PUT URL for a report upload.
 * The field is `signed_url` (the documented legacy contract), not `url`.
 */
export async function createReportHandler(
  context: Pick<HandlerContextWithPath<'reports', '/api/report'>, 'components' | 'verification'>
): Promise<HTTPResponse<{ signed_url: string }>> {
  const user = context.verification?.auth?.toLowerCase()
  if (!user) throw new UnauthorizedError('Authentication required')

  const { url } = await context.components.reports.createReportUploadUrl(user)

  return { status: 200, body: { ok: true, data: { signed_url: url } } }
}
