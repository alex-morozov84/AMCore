import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import type { PinoLogger } from 'nestjs-pino'

import { StorageProbeIo } from './storage-probe.io'
import { StorageProbeService } from './storage-probe.service'

import type { EnvService } from '@/env/env.service'
import type { MetricsService } from '@/infrastructure/observability'

function env(values: Record<string, unknown>): EnvService {
  return { get: (key: string) => values[key] } as unknown as EnvService
}
const signal = () => new AbortController().signal

describe('storage diagnostic driver I/O', () => {
  it('uses local reserved folder and removes only its own file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'amcore-storage-probe-'))
    try {
      await writeFile(path.join(root, 'user-file'), 'keep')
      const io = new StorageProbeIo(env({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_ROOT: root }))
      await io.write('abc.bin', Buffer.from('test'), signal())
      expect(await io.read('abc.bin', signal())).toEqual(Buffer.from('test'))
      await io.remove('abc.bin', signal())
      expect(await readdir(path.join(root, 'objects', '.amcore-probes'))).toEqual([])
      expect(await readdir(root)).toContain('user-file')
      await expect(io.write('../escape.bin', Buffer.from('test'), signal())).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses only private Put/Get/Delete and no HEAD/List for a restricted S3-compatible prefix', async () => {
    const mock = mockClient(S3Client)
    try {
      mock.on(PutObjectCommand).resolves({})
      mock.on(GetObjectCommand).callsFake(() => ({
        Body: Readable.from([Buffer.from('AMCore isolated storage diagnostic\n')]),
      }))
      mock.on(DeleteObjectCommand).resolves({})
      const config = env({
        STORAGE_DRIVER: 's3',
        STORAGE_REGION: 'auto',
        STORAGE_ENDPOINT: 'https://s3.example.test',
        STORAGE_BUCKET: 'test-bucket',
        STORAGE_ACCESS_KEY_ID: 'fake',
        STORAGE_SECRET_ACCESS_KEY: 'fake',
        STORAGE_PROBE_PREFIX: 'allowed/__amcore_probes__',
        STORAGE_FORCE_PATH_STYLE: true,
        STORAGE_PROBE_INTERVAL_SECONDS: 60,
        STORAGE_PROBE_TIMEOUT_SECONDS: 10,
      })
      const io = new StorageProbeIo(config)
      const service = new StorageProbeService(
        config,
        io,
        {} as MetricsService,
        { warn: jest.fn() } as unknown as PinoLogger
      )
      await service.run()
      expect(service.snapshot().state).toBe('healthy')
      expect(mock.commandCalls(PutObjectCommand)).toHaveLength(1)
      expect(mock.commandCalls(GetObjectCommand)).toHaveLength(1)
      expect(mock.commandCalls(DeleteObjectCommand)).toHaveLength(1)
      expect(mock.commandCalls(HeadObjectCommand)).toHaveLength(0)
      const put = mock.commandCalls(PutObjectCommand)[0]!.args[0].input
      expect(put.Key).toMatch(/^allowed\/__amcore_probes__\/[a-f0-9-]+\.bin$/)
      expect(put.ACL).toBeUndefined()
      expect(put.Body).toBeInstanceOf(Buffer)
      io.destroy()
    } finally {
      mock.restore()
    }
  })
})
