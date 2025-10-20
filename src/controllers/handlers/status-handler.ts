import type { HandlerContextWithPath } from '../../types'

// handlers arguments only type what they need, to make unit testing easier
export async function statusHandler(
  context: Pick<HandlerContextWithPath<'config', '/status'>, 'components'>
): Promise<{ status: number; body: string }> {
  const {
    components: { config }
  } = context

  const version = await config.getString('VERSION')
  const image = await config.getString('IMAGE')

  return {
    status: 200,
    body: JSON.stringify({ status: 'ok', timestamp: new Date(), version, image })
  }
}
