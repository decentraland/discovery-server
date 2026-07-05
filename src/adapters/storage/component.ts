import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { IConfigComponent, ILoggerComponent } from '@well-known-components/interfaces'
import type { IStorageComponent, UploadUrlOptions } from './types'

const DEFAULT_EXPIRES_IN = 300

export type StorageOptions = {
  /** Config key holding the bucket name (e.g. CONTENT_MODERATION_BUCKET_NAME). */
  bucketConfigKey: string
  /** Config key holding the public hostname the bucket is served from. */
  hostnameConfigKey?: string
}

/**
 * S3-backed object storage. Uses the AWS SDK directly (not @dcl/s3-component)
 * because the report flow needs presigned PUT URLs, which that component does
 * not expose. Instantiated once per bucket (reports, posters, manifest).
 * Honours AWS_ENDPOINT for LocalStack in dev/test.
 */
export async function createStorageComponent(
  components: Pick<{ config: IConfigComponent; logs: ILoggerComponent }, 'config' | 'logs'>,
  options: StorageOptions
): Promise<IStorageComponent> {
  const { config } = components

  const bucket = (await config.getString(options.bucketConfigKey)) ?? ''
  const region = (await config.getString('AWS_REGION')) ?? 'us-east-1'
  const endpoint = await config.getString('AWS_ENDPOINT')
  const hostname = options.hostnameConfigKey ? await config.getString(options.hostnameConfigKey) : undefined
  const accessKeyId = await config.getString('AWS_ACCESS_KEY')
  const secretAccessKey = await config.getString('AWS_ACCESS_SECRET')

  // Explicit creds when configured; dummy creds against a LocalStack endpoint (it
  // accepts anything); otherwise fall back to the default provider chain (IAM role).
  const credentials =
    accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : endpoint
        ? { accessKeyId: 'test', secretAccessKey: 'test' }
        : undefined

  const client = new S3Client({
    region,
    ...(credentials ? { credentials } : {}),
    ...(endpoint ? { endpoint, forcePathStyle: true } : {})
  })

  async function getUploadUrl(key: string, uploadOptions: UploadUrlOptions = {}): Promise<string> {
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: uploadOptions.contentType })
    return getSignedUrl(client, command, { expiresIn: uploadOptions.expiresIn ?? DEFAULT_EXPIRES_IN })
  }

  async function uploadObject(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void> {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
  }

  function publicUrl(key: string): string {
    if (hostname) return `${hostname.replace(/\/$/, '')}/${key}`
    if (endpoint) return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`
  }

  return { getUploadUrl, uploadObject, publicUrl }
}
