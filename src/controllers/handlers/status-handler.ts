import type { HandlerContextWithPath, HTTPResponse } from '../../types'

/** Health/version endpoint. Preserves the legacy `/api/status` public shape. */
export async function statusHandler(
  context: Pick<HandlerContextWithPath<'config', '/api/status'>, 'components'>
): Promise<HTTPResponse<{ commitHash: string; version: string; time: number }>> {
  const { config } = context.components
  const [commitHash, version] = await Promise.all([
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        commitHash: commitHash ?? 'unknown',
        version: version ?? 'unknown',
        time: Date.now()
      }
    }
  }
}
