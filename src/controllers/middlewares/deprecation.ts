import type { IHttpServerComponent } from '@dcl/core-commons'

/**
 * Marks a legacy route as deprecated in favor of a `/v1` successor. Adds the
 * `Deprecation: true` and `Link: <successor>; rel="successor-version"` response
 * headers (and `Sunset` when a retirement date is configured). Applied only to
 * legacy routes that actually have a v1 replacement — routes with no successor are
 * left unmarked. The response body is unchanged (headers are additive), preserving
 * byte-parity for existing consumers.
 */
export function createDeprecationMiddleware(successor: string, sunset?: string) {
  return async function (
    _ctx: IHttpServerComponent.DefaultContext,
    next: () => Promise<IHttpServerComponent.IResponse>
  ): Promise<IHttpServerComponent.IResponse> {
    const response = await next()
    const headers: Record<string, string> = {
      ...((response.headers as Record<string, string>) ?? {}),
      Deprecation: 'true',
      Link: `<${successor}>; rel="successor-version"`
    }
    if (sunset) headers.Sunset = sunset
    return { ...response, headers }
  }
}
