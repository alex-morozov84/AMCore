import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

import { Controller, Get, Header, Query, Res, StreamableFile } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AuthType } from '@amcore/shared'

import { InvalidObjectKeyError, normalizeObjectKey } from './object-key'
import { type FileMetadata, StorageObjectNotFoundError } from './storage.interface'
import { StorageService } from './storage.service'
import { isPublicKey } from './storage-namespace'

import { AppException, NotFoundException } from '@/common/exceptions'
import { Auth } from '@/core/auth/decorators/auth.decorator'
import { EnvService } from '@/env/env.service'
import { RateLimit } from '@/infrastructure/throttling'

/** Content types a browser may show inline; everything else downloads as opaque bytes. */
const SAFE_TYPE = /^(image\/(png|jpeg|webp|gif|avif)|application\/pdf|text\/plain)$/
/** A stored Cache-Control is echoed only when it is plain directives (no CR/LF injection). */
const SAFE_CACHE_CONTROL = /^[A-Za-z0-9=, -]{1,200}$/

interface PublicFile {
  stream: Readable
  metadata: FileMetadata
}

/**
 * The only unauthenticated file route. It serves exactly the keys under the reserved
 * `public/` namespace, never anything else, from one of two places:
 *
 * - the local driver: the separate public copy tree (private bytes are never read);
 * - the s3 driver in `STORAGE_PUBLIC_DELIVERY=api` mode: the object, read with the
 *   application's own credentials, so no bucket has to be public on the provider.
 *
 * With any other configuration it answers 404, so enabling it is an explicit choice.
 */
@ApiTags('Storage')
@Auth(AuthType.None)
// A page of avatars asks for dozens of public files from one address at once; the default
// policy would answer the 51st image of a list with 429. The reads are cheap and cacheable.
@RateLimit({ rate: 600, per: 60_000, burst: 300 })
@Controller('storage/public')
export class StoragePublicController {
  constructor(
    private readonly env: EnvService,
    private readonly storage: StorageService,
    private readonly adapterHost: HttpAdapterHost
  ) {}

  @Get()
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  @ApiOperation({
    summary: 'Download a public file',
    description:
      'Serves only keys under the public/ namespace: from the local public copy tree with the local driver, ' +
      'or through the application credentials with the s3 driver in STORAGE_PUBLIC_DELIVERY=api mode. ' +
      'Private keys, sidecars and diagnostic files are never served. ' +
      'Cache-Control is the value stored with the object (immutable for versioned avatars), otherwise no-store.',
  })
  @ApiQuery({ name: 'key', type: String, required: true })
  @ApiResponse({
    status: 200,
    description: 'Public file bytes',
    headers: {
      'Cache-Control': {
        description: 'Stored directives, or no-store',
        schema: { type: 'string' },
      },
      ETag: { description: 'Object version when the driver knows it', schema: { type: 'string' } },
    },
    content: {
      'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No public file with this key, or public delivery is not served by this API',
  })
  @ApiResponse({ status: 500, description: 'Unexpected storage failure' })
  async download(
    @Query('key') key: string,
    @Res({ passthrough: true }) res: unknown
  ): Promise<StreamableFile> {
    const source = this.source()
    const normalized = this.publicKey(key)
    let file: PublicFile
    try {
      file =
        source === 'local' ? await this.fromLocal(normalized) : await this.fromStorage(normalized)
    } catch (error) {
      throw this.mapError(error)
    }
    const adapter = this.adapterHost.httpAdapter
    adapter.setHeader(res, 'Cache-Control', cacheControlOf(file.metadata))
    if (file.metadata.etag) adapter.setHeader(res, 'ETag', `"${file.metadata.etag}"`)
    return new StreamableFile(file.stream, {
      type: safeContentType(file.metadata.contentType),
      disposition: 'attachment',
      length: file.metadata.contentLength,
    })
  }

  /** Where this deployment serves public files from, or 404 when this API does not. */
  private source(): 'local' | 'storage' {
    const driver = this.env.get('STORAGE_DRIVER')
    if (driver === 'local') return 'local'
    if (driver === 's3' && this.env.get('STORAGE_PUBLIC_DELIVERY') === 'api') return 'storage'
    throw new NotFoundException('Public file')
  }

  private publicKey(key: string): string {
    try {
      const normalized = normalizeObjectKey(key)
      if (isPublicKey(normalized)) return normalized
    } catch (error) {
      if (!(error instanceof InvalidObjectKeyError)) throw error
    }
    throw new NotFoundException('Public file')
  }

  /** The stream reads only a public copy, so a concurrent private rewrite cannot leak bytes. */
  private async fromLocal(key: string): Promise<PublicFile> {
    const root = path.resolve(this.env.get('STORAGE_LOCAL_ROOT'), 'public')
    const file = path.resolve(root, key)
    if (!file.startsWith(root + path.sep)) throw new NotFoundException('Public file')
    const metadata = await this.storage.getMetadata(key)
    if (metadata.visibility !== 'public-read' || !(await stat(file)).isFile()) {
      throw new NotFoundException('Public file')
    }
    return { stream: createReadStream(file), metadata }
  }

  private async fromStorage(key: string): Promise<PublicFile> {
    const metadata = await this.storage.getMetadata(key)
    return { stream: await this.storage.downloadStream(key), metadata }
  }

  private mapError(error: unknown): Error {
    if (
      error instanceof NotFoundException ||
      error instanceof StorageObjectNotFoundError ||
      (error as NodeJS.ErrnoException)?.code === 'ENOENT'
    ) {
      return new NotFoundException('Public file')
    }
    return new AppException('Storage download failed', 500, 'STORAGE_DOWNLOAD_FAILED')
  }
}

function safeContentType(declared?: string): string {
  const type = declared?.toLowerCase().split(';')[0]?.trim()
  return type && SAFE_TYPE.test(type) ? type : 'application/octet-stream'
}

/** Versioned public keys are immutable and say so when stored; anything else is not cached. */
function cacheControlOf(metadata: FileMetadata): string {
  const stored = metadata.cacheControl?.trim()
  return stored && SAFE_CACHE_CONTROL.test(stored) ? stored : 'no-store'
}
