import type { IHttpServerComponent } from '@dcl/core-commons'
import type { DecentralandSignatureContext } from '@dcl/crypto-middleware'
import type { AppComponents } from './system'

/**
 * Handler context that only types the components a handler actually needs
 * (via `Pick`), plus the optional signed-fetch verification set by the
 * `@dcl/crypto-middleware`.
 */
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = any
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }> &
    DecentralandSignatureContext<any>,
  Path
>

export type JsonBody = Record<string, any>
export type ResponseBody = JsonBody | string

/** Canonical handler return shape. */
export type HTTPResponse<T = unknown> = {
  status: number
  headers?: Record<string, string>
  body?:
    | {
        ok: false
        error: string
        message?: string
      }
    | {
        ok?: true
        data?: T
        total?: number
      }
    | string
}
