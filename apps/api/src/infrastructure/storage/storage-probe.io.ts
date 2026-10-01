import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Injectable } from '@nestjs/common'

import { EnvService } from '@/env/env.service'

/** Reserved diagnostic bytes never enter the user-object/metadata namespace. */
@Injectable()
export class StorageProbeIo {
  private readonly client?: S3Client
  private readonly memory = new Map<string, Buffer>()

  constructor(private readonly env: EnvService) {
    if (env.get('STORAGE_DRIVER') !== 's3') return
    this.client = new S3Client({
      region: env.get('STORAGE_REGION'),
      endpoint: env.get('STORAGE_ENDPOINT') || undefined,
      credentials: {
        accessKeyId: env.get('STORAGE_ACCESS_KEY_ID')!,
        secretAccessKey: env.get('STORAGE_SECRET_ACCESS_KEY')!,
      },
      forcePathStyle: env.get('STORAGE_FORCE_PATH_STYLE'),
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 1,
    })
  }

  async write(key: string, body: Buffer, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.client) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.env.get('STORAGE_BUCKET'),
          Key: this.s3Key(key),
          Body: body,
          ContentType: 'application/octet-stream',
        }),
        { abortSignal: signal }
      )
    } else if (this.env.get('STORAGE_DRIVER') === 'local') {
      const file = this.localPath(key)
      await mkdir(path.dirname(file), { recursive: true })
      signal.throwIfAborted()
      await writeFile(file, body, { signal, mode: 0o600 })
      const meta = this.localPath(key, 'meta')
      await mkdir(path.dirname(meta), { recursive: true })
      signal.throwIfAborted()
      await writeFile(meta, Buffer.from('private'), { signal, mode: 0o600 })
    } else {
      this.memory.set(key, Buffer.from(body))
    }
  }

  async read(key: string, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted()
    if (this.client) {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.env.get('STORAGE_BUCKET'),
          Key: this.s3Key(key),
        }),
        { abortSignal: signal }
      )
      if (!result.Body) throw new Error('Missing probe body')
      // Destroy a streaming body on deadline too, not just the HTTP request.
      const body = result.Body
      const abort = (): void => {
        if ('destroy' in body) body.destroy()
      }
      signal.addEventListener('abort', abort, { once: true })
      try {
        signal.throwIfAborted()
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of body as Readable) {
          signal.throwIfAborted()
          const bytes = Buffer.from(chunk)
          size += bytes.length
          if (size > 1024) {
            abort()
            throw new Error('Oversized probe response')
          }
          chunks.push(bytes)
        }
        return Buffer.concat(chunks)
      } finally {
        signal.removeEventListener('abort', abort)
      }
    }
    if (this.env.get('STORAGE_DRIVER') === 'local') {
      const meta = await readFile(this.localPath(key, 'meta'), { signal })
      if (meta.toString() !== 'private') throw new Error('Invalid probe metadata')
      return readFile(this.localPath(key), { signal })
    }
    return Buffer.from(this.memory.get(key) ?? [])
  }

  async remove(key: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.client) {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.env.get('STORAGE_BUCKET'),
          Key: this.s3Key(key),
        }),
        { abortSignal: signal }
      )
    } else if (this.env.get('STORAGE_DRIVER') === 'local') {
      const outcomes = await Promise.allSettled([
        rm(this.localPath(key), { force: true }),
        rm(this.localPath(key, 'meta'), { force: true }),
      ])
      const failure = outcomes.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    } else {
      this.memory.delete(key)
    }
  }

  destroy(): void {
    this.client?.destroy()
  }

  private s3Key(key: string): string {
    return `${this.env.get('STORAGE_PROBE_PREFIX')}/${key}`
  }

  private localPath(key: string, folder = 'objects'): string {
    if (!/^[a-f0-9-]+\.bin$/.test(key)) throw new Error('Invalid probe key')
    return path.resolve(this.env.get('STORAGE_LOCAL_ROOT'), folder, '.amcore-probes', key)
  }
}
