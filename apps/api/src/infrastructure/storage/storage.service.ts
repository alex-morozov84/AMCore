import type { Readable } from 'node:stream'

import { HttpStatus, Inject, Injectable } from '@nestjs/common'

import { AppException } from '../../common/exceptions'

import { STORAGE_PROVIDER } from './storage.constants'
import type {
  CopyObjectInput,
  FileMetadata,
  ListInput,
  ListResult,
  SignedDownloadInput,
  SignedUploadInput,
  StorageCapabilities,
  StorageProvider,
  UploadInput,
  UploadResult,
} from './storage.interface'

/**
 * Facade over the active storage driver (selected by `STORAGE_DRIVER`).
 *
 * Delegates every operation to the injected provider. Its one piece of added
 * logic is fail-fast capability checks: signed/public URL methods throw a clear
 * 501 on drivers that don't support them (local/memory) instead of leaking an
 * opaque provider error. Private-by-default semantics are preserved — the
 * facade adds no implicit visibility.
 */
@Injectable()
export class StorageService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider) {}

  get capabilities(): StorageCapabilities {
    return this.provider.capabilities
  }

  upload(input: UploadInput): Promise<UploadResult> {
    return this.provider.upload(input)
  }

  download(key: string): Promise<Buffer> {
    return this.provider.download(key)
  }

  downloadStream(key: string): Promise<Readable> {
    return this.provider.downloadStream(key)
  }

  getMetadata(key: string): Promise<FileMetadata> {
    return this.provider.getMetadata(key)
  }

  delete(key: string): Promise<void> {
    return this.provider.delete(key)
  }

  deleteMany(keys: string[]): Promise<void> {
    return this.provider.deleteMany(keys)
  }

  exists(key: string): Promise<boolean> {
    return this.provider.exists(key)
  }

  list(input: ListInput): Promise<ListResult> {
    return this.provider.list(input)
  }

  copy(input: CopyObjectInput): Promise<void> {
    return this.provider.copy(input)
  }

  move(input: CopyObjectInput): Promise<void> {
    return this.provider.move(input)
  }

  getSignedDownloadUrl(input: SignedDownloadInput): Promise<string> {
    this.requireCapability('signedUrls', 'getSignedDownloadUrl')
    return this.provider.getSignedDownloadUrl(input)
  }

  getSignedUploadUrl(input: SignedUploadInput): Promise<string> {
    this.requireCapability('signedUrls', 'getSignedUploadUrl')
    return this.provider.getSignedUploadUrl(input)
  }

  /**
   * Public-read URL for a `public-read` object. NOT the app-mediated download
   * route (a guarded streaming controller arrives in a later stage) — this is a
   * pure public/CDN URL constructor.
   */
  getPublicUrl(key: string): string {
    this.requireCapability('publicUrls', 'getPublicUrl')
    return this.provider.getPublicUrl(key)
  }

  private requireCapability(capability: keyof StorageCapabilities, method: string): void {
    if (!this.provider.capabilities[capability]) {
      throw new AppException(
        `Storage method ${method} requires the "${capability}" capability, which the active driver does not support.`,
        HttpStatus.NOT_IMPLEMENTED,
        'STORAGE_CAPABILITY_UNSUPPORTED'
      )
    }
  }
}
