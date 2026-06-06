import { performance } from 'node:perf_hooks'
import type { Readable } from 'node:stream'

import { HttpStatus, Inject, Injectable } from '@nestjs/common'

import { AppException } from '../../common/exceptions'

import type { StorageDriver } from './storage.constants'
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

import { EnvService } from '@/env/env.service'
import { MetricsService, type StorageMetricsOperation } from '@/infrastructure/observability'

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
  private readonly driver: StorageDriver

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
    env: EnvService,
    private readonly metrics: MetricsService
  ) {
    this.driver = env.get('STORAGE_DRIVER')
  }

  get capabilities(): StorageCapabilities {
    return this.provider.capabilities
  }

  upload(input: UploadInput): Promise<UploadResult> {
    return this.track('upload', () => this.provider.upload(input))
  }

  download(key: string): Promise<Buffer> {
    return this.track('download', () => this.provider.download(key))
  }

  downloadStream(key: string): Promise<Readable> {
    return this.track('download_stream', () => this.provider.downloadStream(key))
  }

  getMetadata(key: string): Promise<FileMetadata> {
    return this.track('get_metadata', () => this.provider.getMetadata(key))
  }

  delete(key: string): Promise<void> {
    return this.track('delete', () => this.provider.delete(key))
  }

  deleteMany(keys: string[]): Promise<void> {
    return this.track('delete_many', () => this.provider.deleteMany(keys))
  }

  exists(key: string): Promise<boolean> {
    return this.track('exists', () => this.provider.exists(key))
  }

  list(input: ListInput): Promise<ListResult> {
    return this.track('list', () => this.provider.list(input))
  }

  copy(input: CopyObjectInput): Promise<void> {
    return this.track('copy', () => this.provider.copy(input))
  }

  move(input: CopyObjectInput): Promise<void> {
    return this.track('move', () => this.provider.move(input))
  }

  getSignedDownloadUrl(input: SignedDownloadInput): Promise<string> {
    return this.trackCapabilityOperation('signed_download_url', 'signedUrls', () =>
      this.provider.getSignedDownloadUrl(input)
    )
  }

  getSignedUploadUrl(input: SignedUploadInput): Promise<string> {
    return this.trackCapabilityOperation('signed_upload_url', 'signedUrls', () =>
      this.provider.getSignedUploadUrl(input)
    )
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

  private async track<T>(
    operation: StorageMetricsOperation,
    action: () => Promise<T>,
    startedAt = performance.now()
  ): Promise<T> {
    try {
      const result = await action()
      this.metrics.observeStorageOperation(
        this.driver,
        operation,
        'success',
        (performance.now() - startedAt) / 1000
      )
      return result
    } catch (error) {
      this.metrics.observeStorageOperation(
        this.driver,
        operation,
        'error',
        (performance.now() - startedAt) / 1000
      )
      throw error
    }
  }

  private trackCapabilityOperation<T>(
    operation: StorageMetricsOperation,
    capability: keyof StorageCapabilities,
    action: () => Promise<T>
  ): Promise<T> {
    const startedAt = performance.now()
    try {
      this.requireCapability(capability, operation)
    } catch (error) {
      this.metrics.observeStorageOperation(
        this.driver,
        operation,
        'error',
        (performance.now() - startedAt) / 1000
      )
      throw error
    }
    return this.track(operation, action, startedAt)
  }
}
