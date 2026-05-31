import { createHash } from 'node:crypto'
import { createReadStream, type Stats } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

import { Injectable } from '@nestjs/common'

import { normalizeObjectKey } from '../object-key'
import { DEFAULT_VISIBILITY } from '../storage.constants'
import type {
  CopyObjectInput,
  FileInfo,
  FileMetadata,
  ListInput,
  ListResult,
  SignedDownloadInput,
  SignedUploadInput,
  StorageCapabilities,
  StorageProvider,
  UploadInput,
  UploadResult,
  Visibility,
} from '../storage.interface'

import { bufferFromBody } from './body.util'

export interface LocalStorageConfig {
  root: string
  /**
   * When set, enables `getPublicUrl`, which returns `${publicBaseUrl}/${key}`.
   *
   * The base MUST be an unauthenticated static/CDN route that serves the
   * driver's object bytes — i.e. it must be mounted at `<root>/objects`, NOT at
   * `<root>`. Mounting `<root>` would also expose the private `<root>/meta`
   * sidecars (visibility/etag JSON). It must NOT point at the guarded
   * app-mediated download route.
   */
  publicBaseUrl?: string
}

/** Sidecar JSON kept alongside each object so visibility/contentType survive restarts. */
interface SidecarMeta {
  contentType?: string
  visibility: Visibility
  etag: string
}

const DEFAULT_MAX_KEYS = 1000
// Objects and their metadata live under separate reserved subdirs of the root,
// so no object key can ever collide with a metadata path (a key like
// `foo.meta.json` is just `objects/foo.meta.json`; its metadata is
// `meta/foo.meta.json.json`). The object key namespace stays clean.
const OBJECTS_DIR = 'objects'
const META_DIR = 'meta'

/**
 * Filesystem storage driver (dev default). Stores object bytes under
 * `<root>/objects/<key>` and per-object metadata under `<root>/meta/<key>.json`,
 * so `visibility` is observable and the object key namespace is never shadowed
 * by metadata. Signed URLs are unsupported; `getPublicUrl` works only when a
 * public base is configured.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly capabilities: StorageCapabilities

  constructor(private readonly config: LocalStorageConfig) {
    this.capabilities = { signedUrls: false, publicUrls: Boolean(config.publicBaseUrl) }
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const key = normalizeObjectKey(input.key)
    const body = await bufferFromBody(input.body)
    const etag = createHash('md5').update(body).digest('hex')
    await this.writeFileAt(this.objectPath(key), body)
    const meta: SidecarMeta = {
      contentType: input.contentType,
      visibility: input.visibility ?? DEFAULT_VISIBILITY,
      etag,
    }
    await this.writeFileAt(this.metaPath(key), Buffer.from(JSON.stringify(meta)))
    return { key, size: body.length, etag, contentType: input.contentType }
  }

  async download(key: string): Promise<Buffer> {
    const full = this.objectPath(key)
    await this.statFileOrThrow(full, key)
    return readFile(full)
  }

  async downloadStream(key: string): Promise<Readable> {
    const full = this.objectPath(key)
    await this.statFileOrThrow(full, key)
    return createReadStream(full)
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    const stats = await this.statFileOrThrow(this.objectPath(key), key)
    const meta = await this.readSidecar(key)
    return {
      contentType: meta?.contentType,
      contentLength: stats.size,
      etag: meta?.etag,
      lastModified: stats.mtime,
      visibility: meta?.visibility,
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.objectPath(key)
    try {
      if (!(await stat(full)).isFile()) return // prefix dir / non-object: no-op
    } catch (err) {
      if (this.isErrno(err, 'ENOENT')) return
      throw err
    }
    await rm(full, { force: true })
    await rm(this.metaPath(key), { force: true })
  }

  async deleteMany(keys: string[]): Promise<void> {
    // Local fs has no per-key partial-failure batch; the s3 provider throws
    // StorageDeleteManyException for that case in a later stage.
    for (const key of keys) await this.delete(key)
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.objectPath(key))).isFile()
    } catch {
      return false
    }
  }

  async list(input: ListInput): Promise<ListResult> {
    return this.page(await this.collectFiles(), input)
  }

  getPublicUrl(key: string): string {
    if (!this.config.publicBaseUrl) {
      throw new Error(
        'Public URLs are not configured for the local storage driver (set STORAGE_LOCAL_PUBLIC_BASE_URL)'
      )
    }
    // `${base}/${key}` with no `objects/` segment: the base is expected to be a
    // static mount of `<root>/objects` (see LocalStorageConfig.publicBaseUrl),
    // which keeps URLs clean and the `<root>/meta` sidecars unexposed.
    return `${this.config.publicBaseUrl.replace(/\/+$/, '')}/${normalizeObjectKey(key)}`
  }

  async getSignedDownloadUrl(_input: SignedDownloadInput): Promise<string> {
    throw new Error('Signed URLs are not supported by the local storage driver')
  }

  async getSignedUploadUrl(_input: SignedUploadInput): Promise<string> {
    throw new Error('Signed URLs are not supported by the local storage driver')
  }

  async copy(input: CopyObjectInput): Promise<void> {
    const sourceKey = normalizeObjectKey(input.source)
    const destKey = normalizeObjectKey(input.destination)
    await this.statFileOrThrow(this.objectPath(sourceKey), input.source)
    await this.copyFileAt(this.objectPath(sourceKey), this.objectPath(destKey))
    try {
      await this.copyFileAt(this.metaPath(sourceKey), this.metaPath(destKey))
    } catch (err) {
      if (!this.isErrno(err, 'ENOENT')) throw err
    }
  }

  async move(input: CopyObjectInput): Promise<void> {
    const sourceKey = normalizeObjectKey(input.source)
    const destKey = normalizeObjectKey(input.destination)
    // Same-key move is a no-op: copy-then-delete would otherwise destroy it.
    if (sourceKey === destKey) return
    await this.copy(input)
    await this.delete(input.source)
  }

  private objectPath(key: string): string {
    return this.resolveUnder(OBJECTS_DIR, normalizeObjectKey(key))
  }

  private metaPath(key: string): string {
    return `${this.resolveUnder(META_DIR, normalizeObjectKey(key))}.json`
  }

  private resolveUnder(subdir: string, normalizedKey: string): string {
    const base = path.resolve(this.config.root, subdir)
    const full = path.resolve(base, normalizedKey)
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error(`Object key resolves outside storage root: ${normalizedKey}`)
    }
    return full
  }

  private async writeFileAt(fullPath: string, body: Buffer): Promise<void> {
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, body)
  }

  private async copyFileAt(source: string, destination: string): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  private async collectFiles(): Promise<FileInfo[]> {
    const objectsRoot = path.resolve(this.config.root, OBJECTS_DIR)
    let entries: string[]
    try {
      entries = await readdir(objectsRoot, { recursive: true })
    } catch (err) {
      if (this.isErrno(err, 'ENOENT')) return []
      throw err
    }
    const files: FileInfo[] = []
    for (const entry of entries) {
      const stats = await stat(path.join(objectsRoot, entry))
      if (!stats.isFile()) continue
      files.push({
        key: entry.split(path.sep).join('/'),
        size: stats.size,
        lastModified: stats.mtime,
      })
    }
    return files
  }

  private page(all: FileInfo[], input: ListInput): ListResult {
    const max = input.maxKeys ?? DEFAULT_MAX_KEYS
    const token = input.continuationToken
    const matching = all
      .filter((f) => f.key.startsWith(input.prefix))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const found = token ? matching.findIndex((f) => f.key > token) : 0
    const from = found === -1 ? matching.length : found
    const files = matching.slice(from, from + max)
    const isTruncated = from + max < matching.length
    return {
      files,
      nextToken: isTruncated ? files[files.length - 1]?.key : undefined,
      isTruncated,
    }
  }

  private async statFileOrThrow(fullPath: string, key: string): Promise<Stats> {
    let stats: Stats
    try {
      stats = await stat(fullPath)
    } catch (err) {
      throw this.toNotFound(err, key)
    }
    // A prefix directory (created by nested uploads) is not an object.
    if (!stats.isFile()) throw new Error(`Object not found: ${key}`)
    return stats
  }

  private async readSidecar(key: string): Promise<SidecarMeta | undefined> {
    try {
      return JSON.parse(await readFile(this.metaPath(key), 'utf8')) as SidecarMeta
    } catch {
      return undefined
    }
  }

  private toNotFound(err: unknown, key: string): Error {
    return this.isErrno(err, 'ENOENT') ? new Error(`Object not found: ${key}`) : (err as Error)
  }

  private isErrno(err: unknown, code: string): boolean {
    return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === code
  }
}
