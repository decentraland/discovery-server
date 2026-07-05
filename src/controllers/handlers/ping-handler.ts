import type { HandlerContextWithPath } from '../../types'

export async function pingHandler(_context: Pick<HandlerContextWithPath<'metrics', '/ping'>, 'url'>) {
  return { status: 200, body: 'pong' }
}
