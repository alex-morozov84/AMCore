import type { Readable } from 'node:stream'

import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common'
import type { Response } from 'express'

import { AppException, BadRequestException, NotFoundException } from '../../common/exceptions'

import { InvalidObjectKeyError, normalizeObjectKey } from './object-key'
import { type FileMetadata, StorageObjectNotFoundError } from './storage.interface'
import { StorageService } from './storage.service'

const OCTET_STREAM = 'application/octet-stream'

// Types a browser may render/execute inline. Served as a download with a
// neutral content type so user content can never be a stored-XSS vector — on top
// of the Content-Disposition: attachment + nosniff that already prevent inline use.
const UNSAFE_INLINE_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/xml',
  'text/xml',
])

/**
 * Reusable app-mediated download primitive — streams a PRIVATE object to a
 * response as a safe attachment, with key validation, metadata-driven headers,
 * and leak-free error mapping.
 *
 * ⚠️ SECURITY: this performs NO authorization. It is deliberately NOT a route.
 * An authorized consumer controller (e.g. the avatar/private-file feature) MUST
 * verify ownership/scope for the caller BEFORE invoking `streamObject`. This is
 * not `getPublicUrl` and not a signed URL — it never emits a public/CDN URL.
 */
@Injectable()
export class StorageDownloadService {
  constructor(private readonly storage: StorageService) {}

  /**
   * Set safe download headers on `res` and return a `StreamableFile` for the
   * object at `key`. Maps invalid keys -> 400, missing objects -> 404, and any
   * provider/FS/credential fault -> a generic 500 that leaks nothing.
   */
  async streamObject(key: string, res: Response): Promise<StreamableFile> {
    try {
      const objectKey = normalizeObjectKey(key)
      const metadata = await this.storage.getMetadata(objectKey)
      const stream = await this.storage.downloadStream(objectKey)
      return this.toStreamableFile(res, metadata, stream)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  private toStreamableFile(
    res: Response,
    metadata: FileMetadata,
    stream: Readable
  ): StreamableFile {
    const declared = metadata.contentType ?? OCTET_STREAM
    const contentType = UNSAFE_INLINE_TYPES.has(declared) ? OCTET_STREAM : declared

    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (metadata.etag) res.setHeader('ETag', metadata.etag)
    if (metadata.lastModified) res.setHeader('Last-Modified', metadata.lastModified.toUTCString())

    return new StreamableFile(stream, {
      type: contentType,
      disposition: 'attachment',
      length: metadata.contentLength,
    })
  }

  private mapError(error: unknown): AppException {
    if (error instanceof InvalidObjectKeyError) return new BadRequestException('Invalid object key')
    if (error instanceof StorageObjectNotFoundError)
      return new NotFoundException('Object not found')
    if (error instanceof AppException) return error
    // Collapse provider/FS/S3/credential faults into a leak-free 500.
    return new AppException(
      'Storage download failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
      'STORAGE_DOWNLOAD_FAILED'
    )
  }
}
