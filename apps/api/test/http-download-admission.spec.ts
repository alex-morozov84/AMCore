import { Controller, Get, Module, Param, Res } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { Response } from 'express'
import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'
import request from 'supertest'

import { AllExceptionsFilter } from '../src/common/exceptions/filters/all-exceptions.filter'
import { HttpExceptionFilter } from '../src/common/exceptions/filters/http-exception.filter'
import { EnvService } from '../src/env/env.service'
import { MetricsService } from '../src/infrastructure/observability'
import { MemoryStorageProvider } from '../src/infrastructure/storage/providers/memory-storage.provider'
import { STORAGE_PROVIDER } from '../src/infrastructure/storage/storage.constants'
import { StorageService } from '../src/infrastructure/storage/storage.service'
import { StorageDownloadService } from '../src/infrastructure/storage/storage-download.service'

const bytes = Buffer.from('private-probe-content')
@Controller('download-probe')
class DownloadProbeController {
  constructor(private readonly download: StorageDownloadService) {}
  @Get(':key')
  get(@Param('key') key: string, @Res({ passthrough: true }) res: Response) {
    return this.download.streamObject(key, res)
  }
}
@Module({
  controllers: [DownloadProbeController],
  providers: [
    StorageDownloadService,
    StorageService,
    { provide: STORAGE_PROVIDER, useClass: MemoryStorageProvider },
    { provide: EnvService, useValue: { get: () => 'memory' } },
    { provide: MetricsService, useValue: { observeStorageOperation: jest.fn() } },
  ],
})
class DownloadProbeModule {}

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => new FastifyAdapter()],
] as const) {
  describe(`HTTP real storage download primitive: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    beforeAll(async () => {
      const adapter = makeAdapter()
      app = await NestFactory.create(DownloadProbeModule, adapter, { logger: false })
      const logger = {
        setContext: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as PinoLogger
      const host = app.get(HttpAdapterHost)
      const cls = { getId: () => 'probe' } as ClsService
      app.useGlobalFilters(
        new AllExceptionsFilter(host, logger, cls),
        new HttpExceptionFilter(logger, cls, host)
      )
      await app
        .get(StorageService)
        .upload({ key: 'unsafe.html', body: bytes, contentType: 'text/html' })
      await app.init()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    afterAll(async () => {
      if (app) await app.close()
    })
    it.each([undefined, 'bytes=0-3'])(
      'streams attachment and ignores unsupported Range=%s',
      async (range) => {
        const call = request(app.getHttpServer()).get('/download-probe/unsafe.html')
        const result = await (range ? call.set('Range', range) : call)
        expect(result.status).toBe(200)
        expect(result.body).toEqual(bytes)
        expect(result.headers['content-type']).toBe('application/octet-stream')
        expect(result.headers['content-disposition']).toBe('attachment')
        expect(result.headers['x-content-type-options']).toBe('nosniff')
        expect(result.headers['content-length']).toBe(String(bytes.length))
        expect(result.headers.etag).toBeDefined()
        expect(result.headers['last-modified']).toBeDefined()
        expect(result.headers['content-range']).toBeUndefined()
      }
    )
    it('keeps missing object error as JSON before any download bytes', async () => {
      const result = await request(app.getHttpServer()).get('/download-probe/missing')
      expect(result.status).toBe(404)
      expect(result.headers['content-type']).toContain('application/json')
      expect(result.body.errorCode).toBe('RESOURCE_NOT_FOUND')
    })
  })
}
