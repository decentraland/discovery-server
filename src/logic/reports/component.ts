import { randomUUID } from 'crypto'
import type { AppComponents } from '../../types'
import type { IReportsComponent, ReportUpload } from './types'

/**
 * Content-moderation reports. Returns a presigned S3 PUT URL (to the moderation
 * bucket) that the client uploads the report JSON to directly — the service
 * never proxies the payload.
 */
export async function createReportsComponent(
  components: Pick<AppComponents, 'reportsStorage' | 'logs'>
): Promise<IReportsComponent> {
  const { reportsStorage } = components

  async function createReportUploadUrl(user: string): Promise<ReportUpload> {
    const key = `reports/${user.toLowerCase()}/${randomUUID()}.json`
    const url = await reportsStorage.getUploadUrl(key, { contentType: 'application/json' })
    return { url, key }
  }

  return { createReportUploadUrl }
}
