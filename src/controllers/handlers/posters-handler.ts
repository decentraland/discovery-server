import type { HandlerContextWithPath, HTTPResponse } from '../../types'
import { BadRequestError, UnauthorizedError } from '../../types/errors'
import type { PosterFile } from '../../logic/posters'

type PosterContext = Pick<HandlerContextWithPath<'posters'>, 'components' | 'request' | 'verification'>

// @dcl/http-server exposes a web Request, which parses multipart/form-data natively
// via .formData() — no busboy/stream wrapper needed.
async function readPoster(ctx: PosterContext): Promise<PosterFile | undefined> {
  let form: FormData
  try {
    form = await ctx.request.formData()
  } catch {
    throw new BadRequestError('Expected multipart/form-data')
  }
  const candidate = form.get('poster') ?? [...form.values()].find((v) => v instanceof Blob)
  if (!(candidate instanceof Blob)) return undefined
  return { value: Buffer.from(await candidate.arrayBuffer()), mimeType: candidate.type || undefined }
}

/** Legacy `POST /api/poster` — upload a horizontal event poster (multipart). */
export async function createPosterHandler(ctx: PosterContext): Promise<HTTPResponse<{ url: string }>> {
  if (!ctx.verification?.auth) throw new UnauthorizedError('Authentication required')
  const url = await ctx.components.posters.uploadHorizontal(await readPoster(ctx))
  return { status: 200, body: { ok: true, data: { url } } }
}

/** Legacy `POST /api/poster-vertical` — upload a vertical event poster (multipart). */
export async function createVerticalPosterHandler(ctx: PosterContext): Promise<HTTPResponse<{ url: string }>> {
  if (!ctx.verification?.auth) throw new UnauthorizedError('Authentication required')
  const url = await ctx.components.posters.uploadVertical(await readPoster(ctx))
  return { status: 200, body: { ok: true, data: { url } } }
}
