import type { Readable } from 'node:stream'

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ObjectIdentifier,
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Injectable } from '@nestjs/common'

import { InvalidObjectKeyError, normalizeObjectKey } from '../object-key.js'
import { S3_DELETE_OBJECTS_MAX_KEYS } from '../storage.constants.js'
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
  StorageObjectNotFoundError,
  type StorageProvider,
  type UploadInput,
  type UploadResult,
} from '../storage.interface.js'
import {
  assertSameNamespace,
  classifyListPrefix,
  isPublicKey,
  PUBLIC_KEY_PREFIX,
  resolveUploadVisibility,
  visibilityOf,
} from '../storage-namespace.js'
import { buildBucketRootUrl, buildPublicRouteUrl } from '../storage-public-url.js'

import { bufferFromBody } from './body.util.js'
import { createS3Client, type S3ClientSettings } from './s3-client.factory.js'

/** How a public key becomes readable. `api` is served by the public route, not by this driver. */
export type S3PublicDelivery = 'external' | 'acl' | 'api'

export interface S3StorageConfig extends S3ClientSettings {
  bucket: string
  /** Bucket that holds `public/` keys. Defaults to `bucket` (one bucket, one publishable prefix). */
  publicBucket?: string
  /** Browser-facing S3 API origin used only to presign. Defaults to `endpoint`. */
  presignEndpoint?: string
  /** `external` never sends an ACL; `acl` sends `public-read` for `public/` keys. */
  publicDelivery?: S3PublicDelivery
  /** URL that maps to the root of the public bucket (CDN, custom or provider public domain). */
  publicBaseUrl: string
  signedUrlDefaultTtl: number
  signedUrlMaxTtl: number
  /** Buffers larger than this go through lib-storage (multipart); default 5 MiB. */
  multipartThreshold?: number
}

const DEFAULT_MULTIPART_THRESHOLD = 5 * 1024 * 1024
const SIGV4_MAX_TTL_SECONDS = 604800 // 7 days — SigV4 hard limit

/**
 * Production S3 driver. Works with any S3-compatible provider (AWS, R2, Yandex,
 * Selectel, VK Cloud, ...). Private by default. Visibility is the key namespace:
 * objects under `public/` are the only ones the application publishes. In the
 * default `external` mode the driver never sends an ACL, so it works where object
 * ACLs are disabled or unsupported (AWS default buckets, R2, B2, Selectel); the
 * operator publishes `public/*` or the public bucket. `acl` mode opts in to a
 * per-object `public-read` for providers that enforce it.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  readonly capabilities: StorageCapabilities = { signedUrls: true, publicUrls: true }

  private readonly client: S3Client
  private readonly presignClient: S3Client
  private readonly multipartThreshold: number
  private readonly publicBucket: string
  private readonly useAcl: boolean

  constructor(private readonly config: S3StorageConfig) {
    this.client = createS3Client(config)
    const presignOrigin = config.presignEndpoint
    this.presignClient =
      presignOrigin && presignOrigin !== config.endpoint
        ? createS3Client(config, { endpoint: presignOrigin })
        : this.client
    this.multipartThreshold = config.multipartThreshold ?? DEFAULT_MULTIPART_THRESHOLD
    this.publicBucket = config.publicBucket || config.bucket
    this.useAcl = config.publicDelivery === 'acl'
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
      new HeadObjectCommand({ Bucket: this.bucketFor(key), Key: key })
    )
    return {
      key,
      size: head.ContentLength ?? 0,
      etag,
      contentType: input.contentType ?? head.ContentType,
    }
  }

  async download(key: string): Promise<Buffer> {
    const res = await this.getObject(key)
    return bufferFromBody(res.Body as unknown as Readable)
  }

  async downloadStream(key: string): Promise<Readable> {
    const res = await this.getObject(key)
    return res.Body as unknown as Readable
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    const objectKey = normalizeObjectKey(key)
    let res
    try {
      res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey })
      )
    } catch (err) {
      throw this.mapNotFound(err, key)
    }
    return {
      contentType: res.ContentType,
      contentLength: res.ContentLength ?? 0,
      etag: stripQuotes(res.ETag),
      lastModified: res.LastModified,
      cacheControl: res.CacheControl,
      // The namespace is authoritative by construction; reachability is the operator's
      // setup, verified by the public-delivery check.
      visibility: visibilityOf(objectKey),
    }
  }

  async delete(key: string): Promise<void> {
    const objectKey = normalizeObjectKey(key)
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey })
    )
  }

  async deleteMany(keys: string[]): Promise<void> {
    const byBucket = new Map<string, string[]>()
    for (const key of keys.map((k) => normalizeObjectKey(k))) {
      const bucket = this.bucketFor(key)
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), key])
    }
    const failures: StorageDeleteFailure[] = []
    for (const [bucket, bucketKeys] of byBucket) {
      for (let i = 0; i < bucketKeys.length; i += S3_DELETE_OBJECTS_MAX_KEYS) {
        const objects: ObjectIdentifier[] = bucketKeys
          .slice(i, i + S3_DELETE_OBJECTS_MAX_KEYS)
          .map((Key) => ({ Key }))
        const res = await this.client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } })
        )
        for (const err of res.Errors ?? []) {
          // Carry only key + code — never credential material / secrets.
          failures.push({ key: err.Key ?? '', code: err.Code })
        }
      }
    }
    if (failures.length > 0) throw new StorageDeleteManyException(failures)
  }

  async exists(key: string): Promise<boolean> {
    const objectKey = normalizeObjectKey(key)
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey })
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
        Bucket: this.bucketForPrefix(input.prefix),
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
    // `api` mode: the API public route serves the object with the application's own
    // credentials, so the address is the route's query form, not a bucket-root form.
    return this.config.publicDelivery === 'api'
      ? buildPublicRouteUrl(this.config.publicBaseUrl, key)
      : buildBucketRootUrl(this.config.publicBaseUrl, key)
  }

  async getSignedDownloadUrl(input: SignedDownloadInput): Promise<string> {
    const key = normalizeObjectKey(input.key)
    const command = new GetObjectCommand({
      Bucket: this.bucketFor(key),
      Key: key,
      ResponseContentDisposition: input.contentDisposition,
      ResponseContentType: input.contentType,
    })
    return getSignedUrl(this.presignClient, command, { expiresIn: this.clampTtl(input.expiresIn) })
  }

  /**
   * The address the SDK uses for `key` (path-style or virtual-hosted, per provider
   * configuration), minus the signature. Requesting it without credentials must be denied
   * for a private object; deriving it from the SDK keeps the addressing rules in one place.
   */
  async getUnsignedObjectUrl(key: string): Promise<string> {
    const objectKey = normalizeObjectKey(key)
    const signed = new URL(
      await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey }),
        { expiresIn: 60 }
      )
    )
    signed.search = ''
    return signed.toString()
  }

  async getSignedUploadUrl(input: SignedUploadInput): Promise<string> {
    const key = normalizeObjectKey(input.key)
    const command = new PutObjectCommand({
      Bucket: this.bucketFor(key),
      Key: key,
      ContentType: input.contentType,
    })
    return getSignedUrl(this.presignClient, command, { expiresIn: this.clampTtl(input.expiresIn) })
  }

  async copy(input: CopyObjectInput): Promise<void> {
    const source = normalizeObjectKey(input.source)
    const destination = normalizeObjectKey(input.destination)
    assertSameNamespace(source, destination)
    const bucket = this.bucketFor(source)
    const encodedSource = source.split('/').map(encodeURIComponent).join('/')
    await this.client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${encodedSource}`,
        Key: destination,
        // A copy does not inherit the source ACL (AWS sets it to private), so `acl`
        // mode applies it again; `external` mode sends no ACL at all.
        ACL: this.aclFor(destination),
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

  private bucketFor(key: string): string {
    return isPublicKey(key) ? this.publicBucket : this.config.bucket
  }

  private bucketForPrefix(prefix: string): string {
    const scope = classifyListPrefix(prefix)
    if (scope === 'public') return this.publicBucket
    if (scope === 'private' || this.publicBucket === this.config.bucket) return this.config.bucket
    throw new InvalidObjectKeyError(
      `list prefix "${prefix}" spans both namespaces; use a prefix inside "${PUBLIC_KEY_PREFIX}" or outside it`
    )
  }

  private aclFor(key: string): 'public-read' | undefined {
    return this.useAcl && isPublicKey(key) ? 'public-read' : undefined
  }

  private putParams(key: string, input: UploadInput): PutObjectCommandInput {
    resolveUploadVisibility(key, input.visibility)
    return {
      Bucket: this.bucketFor(key),
      Key: key,
      ContentType: input.contentType,
      ContentDisposition: input.contentDisposition,
      CacheControl: input.cacheControl,
      Metadata: input.metadata,
      ACL: this.aclFor(key),
    }
  }

  private clampTtl(requested?: number): number {
    const value = requested ?? this.config.signedUrlDefaultTtl
    const max = Math.min(this.config.signedUrlMaxTtl, SIGV4_MAX_TTL_SECONDS)
    return Math.max(1, Math.min(value, max))
  }

  private async getObject(key: string): Promise<GetObjectCommandOutput> {
    const objectKey = normalizeObjectKey(key)
    let res: GetObjectCommandOutput
    try {
      res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketFor(objectKey), Key: objectKey })
      )
    } catch (err) {
      throw this.mapNotFound(err, key)
    }
    if (!res.Body) throw new StorageObjectNotFoundError(key)
    return res
  }

  /** Rethrow a missing-object error as the typed not-found; pass anything else through. */
  private mapNotFound(err: unknown, key: string): unknown {
    return this.isNotFound(err) ? new StorageObjectNotFoundError(key) : err
  }

  private isNotFound(err: unknown): boolean {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
  }
}

function stripQuotes(etag?: string): string | undefined {
  return etag?.replace(/^"|"$/g, '')
}
