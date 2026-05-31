/**
 * In-memory fake S3 backend wired through `aws-sdk-client-mock`, so the shared
 * provider contract can run against `S3StorageProvider` with no network / no
 * MinIO. Emulates just enough of S3: object CRUD, list pagination, copy, batch
 * delete, and multipart upload (used by lib-storage for large bodies).
 *
 * Test-support only (not a `.spec` file, so Jest does not collect it).
 */

import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ObjectIdentifier,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { type AwsStub, mockClient } from 'aws-sdk-client-mock'

import { bufferFromBody } from './body.util'

interface StoredObject {
  body: Buffer
  contentType?: string
  metadata?: Record<string, string>
  etag: string
  lastModified: Date
}

interface MultipartUpload {
  contentType?: string
  metadata?: Record<string, string>
  parts: Map<number, Buffer>
}

export type S3Store = Map<string, StoredObject>

function s3Error(name: string, status: number): Error {
  const err = new Error(name) as Error & { Code: string; $metadata: { httpStatusCode: number } }
  err.name = name
  err.Code = name
  err.$metadata = { httpStatusCode: status }
  return err
}

async function toBuffer(body: unknown): Promise<Buffer> {
  if (body == null) return Buffer.alloc(0)
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof Uint8Array) return Buffer.from(body)
  return bufferFromBody(body as Readable)
}

function etagOf(buf: Buffer): string {
  return `"${createHash('md5').update(buf).digest('hex')}"`
}

function store(s: S3Store, key: string, body: Buffer, meta: Partial<StoredObject>): StoredObject {
  const object: StoredObject = {
    body,
    contentType: meta.contentType,
    metadata: meta.metadata,
    etag: etagOf(body),
    lastModified: new Date(),
  }
  s.set(key, object)
  return object
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupS3Mock(): {
  store: S3Store
  s3Mock: AwsStub<any, any, any>
  restore: () => void
} {
  const objects: S3Store = new Map()
  const multipart = new Map<string, MultipartUpload>()
  let uploadCounter = 0
  const s3Mock = mockClient(S3Client)

  s3Mock.on(PutObjectCommand).callsFake(async (input) => {
    const object = store(objects, input.Key, await toBuffer(input.Body), {
      contentType: input.ContentType,
      metadata: input.Metadata,
    })
    return { ETag: object.etag }
  })

  s3Mock.on(CreateMultipartUploadCommand).callsFake(async (input) => {
    const uploadId = `mpu-${++uploadCounter}`
    multipart.set(uploadId, {
      contentType: input.ContentType,
      metadata: input.Metadata,
      parts: new Map(),
    })
    return { UploadId: uploadId, Bucket: input.Bucket, Key: input.Key }
  })

  s3Mock.on(UploadPartCommand).callsFake(async (input) => {
    const mpu = multipart.get(input.UploadId ?? '')
    if (!mpu) throw s3Error('NoSuchUpload', 404)
    mpu.parts.set(input.PartNumber ?? 0, await toBuffer(input.Body))
    return { ETag: `"part-${input.PartNumber ?? 0}"` }
  })

  s3Mock.on(CompleteMultipartUploadCommand).callsFake(async (input) => {
    const mpu = multipart.get(input.UploadId ?? '')
    if (!mpu) throw s3Error('NoSuchUpload', 404)
    const ordered = [...mpu.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, buf]) => buf)
    const object = store(objects, input.Key, Buffer.concat(ordered), {
      contentType: mpu.contentType,
      metadata: mpu.metadata,
    })
    multipart.delete(input.UploadId ?? '')
    return { ETag: object.etag, Bucket: input.Bucket, Key: input.Key }
  })

  s3Mock.on(GetObjectCommand).callsFake(async (input) => {
    const object = objects.get(input.Key)
    if (!object) throw s3Error('NoSuchKey', 404)
    return {
      Body: Readable.from(object.body),
      ContentType: object.contentType,
      ContentLength: object.body.length,
      ETag: object.etag,
      LastModified: object.lastModified,
      Metadata: object.metadata,
    }
  })

  s3Mock.on(HeadObjectCommand).callsFake(async (input) => {
    const object = objects.get(input.Key)
    if (!object) throw s3Error('NotFound', 404)
    return {
      ContentType: object.contentType,
      ContentLength: object.body.length,
      ETag: object.etag,
      LastModified: object.lastModified,
      Metadata: object.metadata,
    }
  })

  s3Mock.on(DeleteObjectCommand).callsFake(async (input) => {
    objects.delete(input.Key)
    return {}
  })

  s3Mock.on(DeleteObjectsCommand).callsFake(async (input) => {
    const requested: ObjectIdentifier[] = input.Delete?.Objects ?? []
    for (const o of requested) if (o.Key) objects.delete(o.Key)
    return { Deleted: requested.map((o) => ({ Key: o.Key })) }
  })

  s3Mock.on(ListObjectsV2Command).callsFake(async (input) => {
    const prefix = input.Prefix ?? ''
    const max = input.MaxKeys ?? 1000
    const token = input.ContinuationToken
    const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
    const found = token ? keys.findIndex((k) => k > token) : 0
    const from = found === -1 ? keys.length : found
    const page = keys.slice(from, from + max)
    const isTruncated = from + max < keys.length
    const contents = page.flatMap((k) => {
      const object = objects.get(k)
      return object
        ? [
            {
              Key: k,
              Size: object.body.length,
              ETag: object.etag,
              LastModified: object.lastModified,
            },
          ]
        : []
    })
    return {
      Contents: contents,
      KeyCount: contents.length,
      IsTruncated: isTruncated,
      NextContinuationToken: isTruncated ? page[page.length - 1] : undefined,
    }
  })

  s3Mock.on(CopyObjectCommand).callsFake(async (input) => {
    const source = input.CopySource ?? ''
    const sourceKey = source
      .substring(source.indexOf('/') + 1)
      .split('/')
      .map(decodeURIComponent)
      .join('/')
    const object = objects.get(sourceKey)
    if (!object) throw s3Error('NoSuchKey', 404)
    const copied = store(objects, input.Key, object.body, {
      contentType: object.contentType,
      metadata: object.metadata,
    })
    return { CopyObjectResult: { ETag: copied.etag, LastModified: copied.lastModified } }
  })

  return { store: objects, s3Mock, restore: () => s3Mock.restore() }
}
