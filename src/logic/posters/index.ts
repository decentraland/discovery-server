import { randomUUID } from 'crypto'
import type { AppComponents } from '../../types'
import { BadRequestError } from '../../types/errors'

const MAX_POSTER_BYTES = 500 * 1024
const HORIZONTAL_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const VERTICAL_TYPES = ['image/jpeg', 'image/png', 'image/webp'] // no gif
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export type PosterFile = { value: Buffer; mimeType?: string }

/** Legacy poster upload response shape. */
export type PosterUpload = { filename: string; url: string; size: number; type: string }

export interface IPostersComponent {
  /** Validate and store a horizontal poster; returns its filename/url/size/type. */
  uploadHorizontal(file: PosterFile | undefined): Promise<PosterUpload>
  /** Validate and store a vertical poster (no gif); returns its filename/url/size/type. */
  uploadVertical(file: PosterFile | undefined): Promise<PosterUpload>
}

/**
 * Event poster uploads. Validates size (<=500KB) and mime type, then stores the
 * bytes in the poster bucket via the storage adapter and returns the public URL.
 */
export async function createPostersComponent(
  components: Pick<AppComponents, 'postersStorage' | 'logs'>
): Promise<IPostersComponent> {
  const { postersStorage } = components

  async function upload(file: PosterFile | undefined, vertical: boolean): Promise<PosterUpload> {
    if (!file || !file.value?.length) throw new BadRequestError('A poster file is required')
    if (file.value.length > MAX_POSTER_BYTES) throw new BadRequestError('Poster exceeds the 500KB limit')

    const allowed = vertical ? VERTICAL_TYPES : HORIZONTAL_TYPES
    if (!file.mimeType || !allowed.includes(file.mimeType)) {
      throw new BadRequestError(`Unsupported poster type: ${file.mimeType ?? 'unknown'}`)
    }

    const filename = `${vertical ? 'vertical/' : ''}${randomUUID()}.${EXT_BY_MIME[file.mimeType]}`
    const key = `posters/${filename}`
    await postersStorage.uploadObject(key, file.value, file.mimeType)
    return { filename, url: postersStorage.publicUrl(key), size: file.value.length, type: file.mimeType }
  }

  return {
    uploadHorizontal: (file) => upload(file, false),
    uploadVertical: (file) => upload(file, true)
  }
}
