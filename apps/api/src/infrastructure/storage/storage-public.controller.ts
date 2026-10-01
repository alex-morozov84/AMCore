import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AuthType } from '@amcore/shared'

import { normalizeObjectKey } from './object-key'
import { StorageObjectNotFoundError } from './storage.interface'
import { StorageService } from './storage.service'

import { AppException, NotFoundException } from '@/common/exceptions'
import { Auth } from '@/core/auth/decorators/auth.decorator'
import { EnvService } from '@/env/env.service'

/** Public copies are isolated from private objects, metadata and diagnostic files. */
@ApiTags('Storage')
@Auth(AuthType.None)
@Controller('storage/public')
export class StoragePublicController {
  constructor(
    private readonly env: EnvService,
    private readonly storage: StorageService
  ) {}

  @Get()
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Download an explicitly public local file',
    description:
      'Only the local driver; private objects, sidecars and diagnostic files are never served.',
  })
  @ApiQuery({ name: 'key', type: String, required: true })
  @ApiResponse({
    status: 200,
    description: 'Public file bytes',
    content: {
      'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 404, description: 'No public local file with this key' })
  @ApiResponse({ status: 500, description: 'Unexpected storage failure' })
  async download(@Query('key') key: string): Promise<StreamableFile> {
    if (this.env.get('STORAGE_DRIVER') !== 'local') throw new NotFoundException('Public file')
    let normalized: string
    try {
      normalized = normalizeObjectKey(key)
    } catch {
      throw new NotFoundException('Public file')
    }
    const root = path.resolve(this.env.get('STORAGE_LOCAL_ROOT'), 'public')
    const file = path.resolve(root, normalized)
    if (!file.startsWith(root + path.sep)) throw new NotFoundException('Public file')
    let metadata
    try {
      metadata = await this.storage.getMetadata(normalized)
      if (metadata.visibility !== 'public-read' || !(await stat(file)).isFile()) {
        throw new NotFoundException('Public file')
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof StorageObjectNotFoundError ||
        (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      )
        throw new NotFoundException('Public file')
      throw new AppException('Storage download failed', 500, 'STORAGE_DOWNLOAD_FAILED')
    }
    const type = metadata.contentType?.toLowerCase().split(';')[0]?.trim()
    const safeType =
      type && /^(image\/(png|jpeg|webp|gif|avif)|application\/pdf|text\/plain)$/.test(type)
        ? type
        : 'application/octet-stream'
    // The stream reads only a public copy. Concurrent private rewrites cannot leak
    // private bytes, even if visibility changed after the metadata check.
    return new StreamableFile(createReadStream(file), {
      type: safeType,
      disposition: 'attachment',
      length: metadata.contentLength,
    })
  }
}
