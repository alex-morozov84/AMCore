import { createHash } from 'node:crypto'

import { Controller, HttpCode, Module, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import { ExpressAdapter, FileInterceptor as ExpressFileInterceptor } from '@nestjs/platform-express'
import { FastifyAdapter, FileInterceptor as FastifyFileInterceptor } from '@nestjs/platform-fastify'
import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'
import request from 'supertest'

import { AllExceptionsFilter } from '../src/common/exceptions/filters/all-exceptions.filter'
import { HttpExceptionFilter } from '../src/common/exceptions/filters/http-exception.filter'
import {
  FileValidationPipe,
  type ValidatableFile,
} from '../src/infrastructure/storage/validation/file-validation.pipe'
import { AVATAR_VALIDATION } from '../src/infrastructure/storage/validation/file-validation.presets'

const hardLimit = 6 * 1024 * 1024
const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082',
  'hex'
)

for (const [name, makeAdapter, fileInterceptor] of [
  ['express', () => new ExpressAdapter(), ExpressFileInterceptor],
  ['fastify', () => new FastifyAdapter(), FastifyFileInterceptor],
] as const) {
  @Controller('upload-probe')
  class UploadProbeController {
    @Post()
    @HttpCode(200)
    @UseInterceptors(fileInterceptor('file', { limits: { fileSize: hardLimit } }))
    post(
      @UploadedFile(new FileValidationPipe(AVATAR_VALIDATION))
      file: ValidatableFile & { originalname: string }
    ) {
      return {
        bytes: file.buffer.length,
        hash: createHash('sha256').update(file.buffer).digest('hex'),
        name: file.originalname,
      }
    }
  }
  @Module({ controllers: [UploadProbeController] })
  class UploadProbeModule {}

  describe(`HTTP upload transport and avatar pipe: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    beforeAll(async () => {
      const adapter = makeAdapter()
      app = await NestFactory.create(UploadProbeModule, adapter, {
        logger: false,
        abortOnError: false,
      })
      const host = app.get(HttpAdapterHost)
      const logger = {
        setContext: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      } as unknown as PinoLogger
      const cls = { getId: () => 'probe' } as ClsService
      app.useGlobalFilters(
        new AllExceptionsFilter(host, logger, cls),
        new HttpExceptionFilter(logger, cls, host)
      )
      await app.init()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    afterAll(async () => {
      if (app) await app.close()
    })

    it('accepts magic-byte PNG despite misleading declared type and preserves bytes', async () => {
      const result = await request(app.getHttpServer())
        .post('/upload-probe')
        .attach('file', png, { filename: 'avatar.txt', contentType: 'text/plain' })
      expect(result.status).toBe(200)
      expect(result.body).toEqual({
        bytes: png.length,
        hash: createHash('sha256').update(png).digest('hex'),
        name: 'avatar.txt',
      })
    })
    it.each([AVATAR_VALIDATION.maxSize, AVATAR_VALIDATION.maxSize + 1])(
      'enforces actual avatar bytes at %i',
      async (size) => {
        const file = Buffer.alloc(size)
        png.copy(file)
        const result = await request(app.getHttpServer())
          .post('/upload-probe')
          .attach('file', file, 'avatar.png')
        expect(result.status).toBe(size > AVATAR_VALIDATION.maxSize ? 413 : 200)
        expect(result.body.errorCode).toBe(
          size > AVATAR_VALIDATION.maxSize ? 'FILE_TOO_LARGE' : undefined
        )
      }
    )
    it('enforces hard transport ceiling before avatar pipe', async () => {
      const result = await request(app.getHttpServer())
        .post('/upload-probe')
        .attach('file', Buffer.alloc(hardLimit + 1), 'large.png')
      expect(result.status).toBe(413)
      expect(result.body.errorCode).toBeUndefined()
    })
    it('rejects SVG despite declared PNG type', async () => {
      const result = await request(app.getHttpServer())
        .post('/upload-probe')
        .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
      expect(result.status).toBe(400)
      expect(result.body.errorCode).toBe('BAD_REQUEST')
    })
    it('rejects missing file with the existing domain error', async () => {
      const result = await request(app.getHttpServer())
        .post('/upload-probe')
        .field('name', 'no-file')
      expect(result.status).toBe(400)
      expect(result.body.errorCode).toBe('BAD_REQUEST')
    })
    it('rejects unexpected file field', async () => {
      const result = await request(app.getHttpServer())
        .post('/upload-probe')
        .attach('other', png, 'avatar.png')
      expect(result.status).toBe(400)
    })
    it('rejects a second file in the single-file field', async () => {
      const result = await request(app.getHttpServer())
        .post('/upload-probe')
        .attach('file', png, 'one.png')
        .attach('file', png, 'two.png')
      expect(result.status).toBe(400)
    })
  })
}
