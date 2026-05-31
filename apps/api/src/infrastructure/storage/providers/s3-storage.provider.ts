import type { Readable } from 'node:stream'

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ObjectIdentifier,
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Injectable } from '@nestjs/common'

import { normalizeObjectKey } from '../object-key'
import { DEFAULT_VISIBILITY, S3_DELETE_OBJECTS_MAX_KEYS } from '../storage.constants'
import {
  type CopyObjectInput,
  type FileMetadata,
  type ListInput,
  type ListResult,
  type SignedDownloadInput,
  type SignedUploadInput,
  type StorageCapabilities,
  type StorageDeleteFailure,
  StorageDeleteManyException,
  type StorageProvider,
  type UploadInput,
  type UploadResult,
  type Visibility,
} from '../storage.interface'

import { bufferFromBody } from './body.util'

export interface S3StorageConfig {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** SDK endpoint (may be internal/Docker). Omit for AWS. */
  endpoint?: string
  /** Browser-facing endpoint for public/presigned URLs. Falls back to `endpoint`. */
  publicEndpoint?: string
  forcePathStyle?: boolean
  signedUrlDefaultTtl: number
  signedUrlMaxTtl: number
  /** Buffers larger than this go through lib-storage (multipart); default 5 MiB. */
  multipartThreshold?: number
}

const DEFAULT_MULTIPART_THRESHOLD = 5 * 1024 * 1024
const SIGV4_MAX_TTL_SECONDS = 604800 // 7 days — SigV4 hard limit

/**
 * Production S3 driver. Works with any S3-compatible provider (AWS, R2, DO
 * Spaces, Yandex, B2). Checksum calculation/validation are set to
 * `WHEN_REQUIRED` — without this, non-AWS providers reject the default
 * `x-amz-checksum-*` headers (the #1 production issue). Private-by-default;
 * `public-read` is an explicit opt-in via object ACL + a `visibility` metadata
 * tag (so it stays observable through `getMetadata`).
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  readonly capabilities: StorageCapabilities = { signedUrls: true, publicUrls: true }

  private readonly client: S3Client
  private readonly presignClient: S3Client
  private readonly multipartThreshold: number

  constructor(private readonly config: S3StorageConfig) {
    const base = {
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle ?? false,
      // CRITICAL: without these, non-AWS providers break (501 / InvalidArgument).
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    }
    this.client = new S3Client({ ...base, endpoint: config.endpoint || undefined })
    this.presignClient =
      config.publicEndpoint && config.publicEndpoint !== config.endpoint
        ? new S3Client({ ...base, endpoint: config.publicEndpoint })
        : this.client
    this.multipartThreshold = config.multipartThreshold ?? DEFAULT_MULTIPART_THRESHOLD
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const key = normalizeObjectKey(input.key)
    const params = this.putParams(key, input)

    if (Buffer.isBuffer(input.body) && input.body.length <= this.multipartThreshold) {
      const res = await this.client.send(new PutObjectCommand({ ...params, Body: input.body }))
      return {
        key,
        size: input.body.length,
        etag: stripQuotes(res.ETag),
        contentType: input.contentType,
      }
    }

    const res = await new Upload({
      client: this.client,
      params: { ...params, Body: input.body },
    }).done()
    const etag = stripQuotes('ETag' in res ? res.ETag : undefined)
    if (Buffer.isBuffer(input.body)) {
      return { key, size: input.body.length, etag, contentType: input.contentType }
    }
    // Stream body: size is unknown until stored — read it back via HEAD.
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key })
    )
    return {
      key,
      size: head.ContentLength ?? 0,
      etag,
      contentType: input.contentType ?? head.ContentType,
    }
  }

  async download(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: normalizeObjectKey(key) })
    )
    if (!res.Body) throw new Error(`Object not found: ${key}`)
    return bufferFromBody(res.Body as unknown as Readable)
  }

  async downloadStream(key: string): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: normalizeObjectKey(key) })
    )
    if (!res.Body) throw new Error(`Object not found: ${key}`)
    return res.Body as unknown as Readable
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    const res = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: normalizeObjectKey(key) })
    )
    return {
      contentType: res.ContentType,
      contentLength: res.ContentLength ?? 0,
      etag: stripQuotes(res.ETag),
      lastModified: res.LastModified,
      visibility: res.Metadata?.visibility as Visibility | undefined,
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: normalizeObjectKey(key) })
    )
  }

  async deleteMany(keys: string[]): Promise<void> {
    const normalized = keys.map((k) => normalizeObjectKey(k))
    const failures: StorageDeleteFailure[] = []
    for (let i = 0; i < normalized.length; i += S3_DELETE_OBJECTS_MAX_KEYS) {
      const chunk = normalized.slice(i, i + S3_DELETE_OBJECTS_MAX_KEYS)
      const objects: ObjectIdentifier[] = chunk.map((Key) => ({ Key }))
      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: { Objects: objects, Quiet: true },
        })
      )
      for (const err of res.Errors ?? []) {
        // Carry only key + code — never credential material / secrets.
        failures.push({ key: err.Key ?? '', code: err.Code })
      }
    }
    if (failures.length > 0) throw new StorageDeleteManyException(failures)
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: normalizeObjectKey(key) })
      )
      return true
    } catch (err) {
      if (this.isNotFound(err)) return false
      throw err
    }
  }

  async list(input: ListInput): Promise<ListResult> {
    const res = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: input.prefix,
        MaxKeys: input.maxKeys,
        ContinuationToken: input.continuationToken,
      })
    )
    return {
      files: (res.Contents ?? []).map((o) => ({
        key: o.Key ?? '',
        size: o.Size ?? 0,
        lastModified: o.LastModified,
        etag: stripQuotes(o.ETag),
      })),
      nextToken: res.NextContinuationToken,
      isTruncated: res.IsTruncated ?? false,
    }
  }

  getPublicUrl(key: string): string {
    const objectKey = normalizeObjectKey(key)
    // An explicit public endpoint is already the public base / CDN — concatenate
    // directly, no bucket synthesis (it's the configured browser-facing root).
    if (this.config.publicEndpoint) {
      return `${this.config.publicEndpoint.replace(/\/+$/, '')}/${objectKey}`
    }
    // Otherwise derive a bucket-style URL from the SDK endpoint, or the AWS
    // virtual-hosted default when no endpoint is configured.
    if (!this.config.endpoint) {
      return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${objectKey}`
    }
    const url = new URL(this.config.endpoint)
    if (this.config.forcePathStyle) {
      return `${url.origin}/${this.config.bucket}/${objectKey}`
    }
    return `${url.protocol}//${this.config.bucket}.${url.host}/${objectKey}`
  }

  async getSignedDownloadUrl(input: SignedDownloadInput): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: normalizeObjectKey(input.key),
      ResponseContentDisposition: input.contentDisposition,
      ResponseContentType: input.contentType,
    })
    return getSignedUrl(this.presignClient, command, { expiresIn: this.clampTtl(input.expiresIn) })
  }

  async getSignedUploadUrl(input: SignedUploadInput): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: normalizeObjectKey(input.key),
      ContentType: input.contentType,
    })
    return getSignedUrl(this.presignClient, command, { expiresIn: this.clampTtl(input.expiresIn) })
  }

  async copy(input: CopyObjectInput): Promise<void> {
    const source = normalizeObjectKey(input.source)
    const encodedSource = source.split('/').map(encodeURIComponent).join('/')
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        CopySource: `${this.config.bucket}/${encodedSource}`,
        Key: normalizeObjectKey(input.destination),
      })
    )
  }

  async move(input: CopyObjectInput): Promise<void> {
    const source = normalizeObjectKey(input.source)
    const destination = normalizeObjectKey(input.destination)
    if (source === destination) return // same-key move is a no-op
    await this.copy(input)
    await this.delete(input.source)
  }

  private putParams(key: string, input: UploadInput): PutObjectCommandInput {
    const visibility: Visibility = input.visibility ?? DEFAULT_VISIBILITY
    return {
      Bucket: this.config.bucket,
      Key: key,
      ContentType: input.contentType,
      ContentDisposition: input.contentDisposition,
      CacheControl: input.cacheControl,
      // Tag visibility in user metadata so it survives and is readable via HEAD.
      Metadata: { ...input.metadata, visibility },
      ACL: visibility === 'public-read' ? 'public-read' : undefined,
    }
  }

  private clampTtl(requested?: number): number {
    const value = requested ?? this.config.signedUrlDefaultTtl
    const max = Math.min(this.config.signedUrlMaxTtl, SIGV4_MAX_TTL_SECONDS)
    return Math.max(1, Math.min(value, max))
  }

  private isNotFound(err: unknown): boolean {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
  }
}

function stripQuotes(etag?: string): string | undefined {
  return etag?.replace(/^"|"$/g, '')
}
