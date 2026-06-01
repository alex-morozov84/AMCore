import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { Injectable } from '@nestjs/common'

import { normalizeObjectKey } from '../object-key'
import { DEFAULT_VISIBILITY } from '../storage.constants'
import {
  type CopyObjectInput,
  type FileInfo,
  type FileMetadata,
  type ListInput,
  type ListResult,
  type SignedDownloadInput,
  type SignedUploadInput,
  type StorageCapabilities,
  StorageObjectNotFoundError,
  type StorageProvider,
  type UploadInput,
  type UploadResult,
} from '../storage.interface'

import { bufferFromBody } from './body.util'

interface StoredObject {
  body: Buffer
  metadata: FileMetadata
}

/** S3's default page size; mirrored so list pagination behaves consistently. */
const DEFAULT_MAX_KEYS = 1000

/**
 * In-memory storage driver (test default). Backed by a `Map`, no external deps.
 *
 * `capabilities` are both `false`: signed/public URL methods fail clearly. The
 * driver persists `visibility` per object so private vs public-read is testable
 * in e2e. Call `reset()` between tests to clear state.
 */
@Injectable()
export class MemoryStorageProvider implements StorageProvider {
  readonly capabilities: StorageCapabilities = { signedUrls: false, publicUrls: false }

  private readonly store = new Map<string, StoredObject>()

  async upload(input: UploadInput): Promise<UploadResult> {
    const key = normalizeObjectKey(input.key)
    const body = await bufferFromBody(input.body)
    const etag = createHash('md5').update(body).digest('hex')
    const metadata: FileMetadata = {
      contentType: input.contentType,
      contentLength: body.length,
      etag,
      lastModified: new Date(),
      visibility: input.visibility ?? DEFAULT_VISIBILITY,
    }
    this.store.set(key, { body, metadata })
    return { key, size: body.length, etag, contentType: input.contentType }
  }

  async download(key: string): Promise<Buffer> {
    return Buffer.from(this.require(key).body)
  }

  async downloadStream(key: string): Promise<Readable> {
    return Readable.from(this.require(key).body)
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    return { ...this.require(key).metadata }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(normalizeObjectKey(key))
  }

  async deleteMany(keys: string[]): Promise<void> {
    // Memory has no per-key partial failure; the s3 provider throws
    // StorageDeleteManyException for that case in a later stage.
    for (const key of keys) this.store.delete(normalizeObjectKey(key))
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(normalizeObjectKey(key))
  }

  async list(input: ListInput): Promise<ListResult> {
    const max = input.maxKeys ?? DEFAULT_MAX_KEYS
    const token = input.continuationToken
    const matching = [...this.store.entries()]
      .filter(([key]) => key.startsWith(input.prefix))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const found = token ? matching.findIndex(([key]) => key > token) : 0
    const from = found === -1 ? matching.length : found
    const page = matching.slice(from, from + max)
    const isTruncated = from + max < matching.length
    return {
      files: page.map(([key, object]) => this.toFileInfo(key, object)),
      nextToken: isTruncated ? page[page.length - 1]?.[0] : undefined,
      isTruncated,
    }
  }

  getPublicUrl(_key: string): string {
    throw new Error('Public URLs are not supported by the memory storage driver')
  }

  async getSignedDownloadUrl(_input: SignedDownloadInput): Promise<string> {
    throw new Error('Signed URLs are not supported by the memory storage driver')
  }

  async getSignedUploadUrl(_input: SignedUploadInput): Promise<string> {
    throw new Error('Signed URLs are not supported by the memory storage driver')
  }

  async copy(input: CopyObjectInput): Promise<void> {
    const source = this.require(input.source)
    const destination = normalizeObjectKey(input.destination)
    this.store.set(destination, {
      body: Buffer.from(source.body),
      metadata: { ...source.metadata, lastModified: new Date() },
    })
  }

  async move(input: CopyObjectInput): Promise<void> {
    const source = normalizeObjectKey(input.source)
    const destination = normalizeObjectKey(input.destination)
    // Same-key move is a no-op: copy-then-delete would otherwise destroy the
    // object (delete runs after the copy overwrote it in place).
    if (source === destination) return
    await this.copy(input)
    this.store.delete(source)
  }

  /** Test helper: clear all stored objects between tests. */
  reset(): void {
    this.store.clear()
  }

  private require(key: string): StoredObject {
    const object = this.store.get(normalizeObjectKey(key))
    if (!object) throw new StorageObjectNotFoundError(key)
    return object
  }

  private toFileInfo(key: string, object: StoredObject): FileInfo {
    return {
      key,
      size: object.metadata.contentLength,
      lastModified: object.metadata.lastModified,
      etag: object.metadata.etag,
    }
  }
}
