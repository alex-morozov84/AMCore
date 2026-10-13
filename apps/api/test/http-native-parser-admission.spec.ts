import { createHash } from 'node:crypto'
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from 'node:zlib'

import { Controller, HttpCode, Module, Patch, Post, Req } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import iconv from 'iconv-lite'
import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'
import request from 'supertest'

import { configureFastifyBodyParser } from '../src/bootstrap/configure-fastify-body-parser'
import { createHttpAdapter } from '../src/bootstrap/create-http-adapter'
import { configureInvitationBoundary } from '../src/bootstrap/invitation-request-boundary'
import { AllExceptionsFilter } from '../src/common/exceptions/filters/all-exceptions.filter'
import { HttpExceptionFilter } from '../src/common/exceptions/filters/http-exception.filter'
import { PrismaClientExceptionFilter } from '../src/common/exceptions/filters/prisma-exception.filter'

import { parserTransportChecks } from './http-parser-transport'
import { configureBodyParser } from './support/express-body-parser'

type ProbeRequest = { rawBody?: Buffer; body: unknown }
@Controller('api/v1')
class BodyProbeController {
  @Post([
    'body-size/echo',
    'auth/invites/accept',
    'organizations/:id/role-definitions',
    'admin/background-work/commands',
  ])
  @HttpCode(200)
  post(@Req() req: ProbeRequest) {
    return {
      bytes: req.rawBody?.length,
      hash: createHash('sha256')
        .update(req.rawBody ?? '')
        .digest('hex'),
      body: req.body,
    }
  }

  @Patch('organizations/:id/members/:memberId/roles')
  @HttpCode(200)
  patch(@Req() req: ProbeRequest) {
    return this.post(req)
  }
}
@Module({ controllers: [BodyProbeController] })
class BodyProbeModule {}

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => createHttpAdapter()],
] as const) {
  describe(`HTTP native parser admission: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    const logCalls = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() }
    beforeAll(async () => {
      const adapter = makeAdapter()
      app = await NestFactory.create(BodyProbeModule, adapter, {
        logger: false,
        rawBody: true,
        abortOnError: false,
      })
      const logger = logCalls as unknown as PinoLogger
      const cls = { getId: () => 'probe' } as ClsService
      const host = app.get(HttpAdapterHost)
      app.useGlobalFilters(
        new AllExceptionsFilter(host, logger, cls),
        new PrismaClientExceptionFilter(logger, cls, host),
        new HttpExceptionFilter(logger, cls, host)
      )
      if (adapter instanceof FastifyAdapter) {
        configureInvitationBoundary(app as NestExpressApplication, '/api/v1')
        await configureFastifyBodyParser(app as NestFastifyApplication)
      } else {
        configureBodyParser(app as NestExpressApplication)
      }
      await app.init()
      await app.listen(0, '127.0.0.1')
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    afterAll(async () => {
      if (app) await app.close()
    })

    it.each([
      ['application/json', '/api/v1/body-size/echo', '{}'],
      ['application/x-www-form-urlencoded', '/api/v1/body-size/echo', 'value=ok'],
      ['application/x-www-form-urlencoded', '/api/v1/admin/background-work/commands', 'value=ok'],
    ])('distinguishes absent/empty/unsupported charset: %s %s', async (media, path, body) => {
      for (const [suffix, status] of [
        ['', 200],
        ['; charset=""', 415],
        ['; charset=utf-unknown', 415],
        ['; charset=', 400],
      ] as const) {
        const response = await request(app.getHttpServer())
          .post(path)
          .set('Content-Type', media + suffix)
          .send(Buffer.from(body))
        expect(response.status).toBe(status)
        expect(response.headers['accept-encoding']).toBeUndefined()
      }
    })

    it('sanitizes parser refusal through production filters including development stack and logs', async () => {
      const previous = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      const sentinel = 'FAKE_BODY_SECRET_HP_R4A'
      logCalls.warn.mockClear()
      logCalls.error.mockClear()
      try {
        const response = await request(app.getHttpServer())
          .post('/api/v1/body-size/echo')
          .set('Content-Type', 'application/json')
          .send(`"${sentinel}"`)
        expect(response.status).toBe(400)
        expect(response.body.errorCode).toBeUndefined()
        expect(response.body.stack).toEqual(expect.any(String))
        expect(JSON.stringify(response.body)).not.toContain(sentinel)
        expect(JSON.stringify(logCalls.warn.mock.calls)).not.toContain(sentinel)
        expect(JSON.stringify(logCalls.error.mock.calls)).not.toContain(sentinel)
        expect(logCalls.warn).toHaveBeenCalled()
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = previous
      }
    })

    parserTransportChecks(
      name,
      () => app.getHttpServer(),
      () => app.getUrl()
    )

    it.each(['plain', 'gzip', 'deflate', 'br'])(
      'bounds unknown routes before404 (%s)',
      async (encoding) => {
        for (const extra of [0, 1]) {
          const body = JSON.stringify({ value: 'x'.repeat(100000 - 12 + extra) })
          expect(Buffer.byteLength(body)).toBe(100000 + extra)
          let call = request(app.getHttpServer())
            .post('/api/v1/unknown')
            .set('Content-Type', 'application/json')
          if (encoding !== 'plain') {
            const compress = {
              gzip: gzipSync,
              deflate: deflateSync,
              br: brotliCompressSync,
              zstd: zstdCompressSync,
            }[encoding as 'gzip' | 'deflate' | 'br' | 'zstd']
            call = call
              .set('Content-Encoding', encoding)
              .serialize(() => compress(body) as unknown as string)
              .send({})
          } else call = call.send(body)
          const result = await call
          expect(result.status).toBe(extra ? 413 : 404)
          expect(result.body.errorCode).toBe(extra ? 'PAYLOAD_TOO_LARGE' : undefined)
        }
      }
    )

    for (const [path, limit] of [
      ['body-size/echo', 100000],
      ['auth/invites/accept', 2048],
      ['organizations/probe/role-definitions', 16384],
      ['admin/background-work/commands', 32768],
    ] as const) {
      for (const compressed of [false, true]) {
        it(`${path}: exact ${limit} decoded bytes accepted; +1 rejected (${compressed ? 'gzip' : 'plain'})`, async () => {
          for (const extra of [0, 1]) {
            const body = JSON.stringify({ padding: 'x'.repeat(limit + extra - 14) })
            expect(Buffer.byteLength(body)).toBe(limit + extra)
            let call = request(app.getHttpServer())
              .post(`/api/v1/${path}`)
              .set('Content-Type', 'application/json')
            if (compressed)
              call = call
                .set('Content-Encoding', 'gzip')
                .serialize(() => gzipSync(body) as unknown as string)
                .send({})
            else call = call.send(body)
            const result = await call
            expect(result.status).toBe(extra ? 413 : 200)
            expect(result.body).toMatchObject(
              extra
                ? { errorCode: 'PAYLOAD_TOO_LARGE' }
                : {
                    bytes: limit,
                    hash: createHash('sha256').update(body).digest('hex'),
                  }
            )
          }
        })
      }
    }

    it.each(['body-size/echo', 'unknown'])('rejects malformed gzip at %s', async (path) => {
      const result = await request(app.getHttpServer())
        .post(`/api/v1/${path}`)
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .serialize(() => Buffer.from('invalid gzip') as unknown as string)
        .send({})
      expect(result.status).toBe(400)
    })

    it.each(['gzip', 'deflate', 'br'] as const)(
      'rejects malformed and truncated %s on known/unknown routes',
      async (encoding) => {
        const compressed = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync }[
          encoding
        ]('{}')
        for (const path of ['body-size/echo', 'unknown']) {
          for (const bytes of [
            Buffer.from('not compressed'),
            compressed.subarray(0, compressed.length - 2),
          ]) {
            const response = await request(app.getHttpServer())
              .post(`/api/v1/${path}`)
              .set('Content-Type', 'application/json')
              .set('Content-Encoding', encoding)
              .serialize(() => bytes as unknown as string)
              .send({})
            expect(response.status).toBe(400)
            expect(response.body.errorCode).toBeUndefined()
          }
        }
      }
    )

    it.each([
      [
        '/api/v1/body-size/echo',
        { items: ['first', 'last'], bad: '%ZZ', partial: '%E', repeated: ['a', 'b'] },
      ],
      [
        '/api/v1/admin/background-work/commands',
        {
          'items[0]': 'first',
          'items[21]': 'last',
          bad: '%ZZ',
          partial: '%E',
          repeated: ['a', 'b'],
        },
      ],
    ])(
      'preserves real form sparse indices, malformed escapes and repeated keys: %s',
      async (path, expected) => {
        const body = 'items[0]=first&items[21]=last&bad=%ZZ&partial=%E&repeated=a&repeated=b'
        const response = await request(app.getHttpServer())
          .post(path)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(body)
        expect(response.status).toBe(200)
        expect(response.body.body).toEqual(expected)
        expect(response.body.hash).toBe(createHash('sha256').update(body).digest('hex'))
      }
    )

    if (name === 'fastify') {
      it('bounds encoded wire bytes separately from a tiny decoded gzip body', async () => {
        const gzip = gzipSync('{}')
        for (const extra of [0, 1]) {
          const header = Buffer.from(gzip.subarray(0, 10))
          header[3] = header[3]! | 0x10 // Valid gzip FCOMMENT field adds wire bytes without decoded bytes.
          const bytes = Buffer.concat([
            header,
            Buffer.alloc(262144 + extra - gzip.length - 1, 0x78),
            Buffer.from([0]),
            gzip.subarray(10),
          ])
          expect(bytes.length).toBe(262144 + extra)
          const response = await request(app.getHttpServer())
            .post('/api/v1/body-size/echo')
            .set('Content-Type', 'application/json')
            .set('Content-Encoding', 'gzip')
            .serialize(() => bytes as unknown as string)
            .send({})
          expect(response.status).toBe(extra ? 413 : 200)
          expect(response.body.errorCode).toBe(extra ? 'PAYLOAD_TOO_LARGE' : undefined)
        }
      })
    }

    it('rejects unsupported JSON charset', async () => {
      const result = await request(app.getHttpServer())
        .post('/api/v1/body-size/echo')
        .set('Content-Type', 'application/json; charset=iso-8859-1')
        .send('{}')
      expect(result.status).toBe(415)
    })

    it('rejects excessive form nesting with400', async () => {
      const result = await request(app.getHttpServer())
        .post('/api/v1/body-size/echo')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`a${'[b]'.repeat(34)}=value`)
      expect(result.status).toBe(400)
    })

    it('preserves ISO8859-1 form decoding', async () => {
      const result = await request(app.getHttpServer())
        .post('/api/v1/body-size/echo')
        .set('Content-Type', 'application/x-www-form-urlencoded; charset=iso-8859-1')
        .send('value=%E9')
      expect(result.status).toBe(200)
      expect(result.body.body).toEqual({ value: 'é' })
    })

    it.each(['utf-8', 'utf-16le', 'utf-16be', 'utf-16', 'utf-32le', 'utf-32be', 'utf-32'])(
      'decodes real Unicode bytes and preserves raw hash: %s',
      async (charset) => {
        const bytes = iconv.encode('{"value":"éЖ😀"}', charset)
        const result = await request(app.getHttpServer())
          .post('/api/v1/body-size/echo')
          .set('Content-Type', `application/json; charset="${charset}"`)
          .serialize(() => bytes as unknown as string)
          .send({})
        expect(result.status).toBe(200)
        expect(result.body.body).toEqual({ value: 'éЖ😀' })
        expect(result.body.hash).toBe(createHash('sha256').update(bytes).digest('hex'))
      }
    )
    it.each([
      'application/json; xcharset=ascii',
      'application/json; note="charset=ascii"',
      'Application/JSON; CHARSET="utf-8"; note="a; b"',
    ])('preserves unrelated/quoted media parameters: %s', async (header) => {
      const result = await request(app.getHttpServer())
        .post('/api/v1/body-size/echo')
        .set('Content-Type', header)
        .send('{}')
      expect(result.status).toBe(200)
    })
    it.each([
      'application/json; charset=utf-8; charset=utf-16',
      'application/json; bad',
      'application/json; note="unterminated',
    ])('rejects invalid or ambiguous header400: %s', async (header) => {
      const result = await request(app.getHttpServer())
        .post('/api/v1/body-size/echo')
        .set('Content-Type', header)
        .send('{}')
      expect(result.status).toBe(400)
    })

    if (name === 'fastify') {
      it.each([
        '{"__proto__":{"polluted":true}}',
        '{"nested":{"__proto__":{"polluted":true}}}',
        '[{"__proto__":{"polluted":true}}]',
        '{"constructor":{"prototype":{"polluted":true}}}',
        '{"nested":{"constructor":{"prototype":{"polluted":true}}}}',
        '[{"constructor":{"prototype":{"polluted":true}}}]',
      ])('rejects dangerous JSON before handler: %s', async (body) => {
        const result = await request(app.getHttpServer())
          .post('/api/v1/body-size/echo')
          .set('Content-Type', 'application/json')
          .send(body)
        expect(result.status).toBe(400)
        expect(Object.prototype).not.toHaveProperty('polluted')
      })
      it('preserves ordinary constructor-shaped values under the upstream policy', async () => {
        const result = await request(app.getHttpServer())
          .post('/api/v1/body-size/echo')
          .set('Content-Type', 'application/json')
          .send('{"constructor":"ordinary"}')
        expect(result.status).toBe(200)
      })
    }

    it('rejects unsupported zstd rather than parsing it', async () => {
      const result = await request(app.getHttpServer())
        .post('/api/v1/unknown')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'zstd')
        .serialize(() => zstdCompressSync('{}') as unknown as string)
        .send({})
      expect(result.status).toBe(415)
    })

    it('preserves nested form parsing', async () => {
      const result = await request(app.getHttpServer())
        .post('/api/v1/body-size/echo')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('user[name]=Alice&roles[]=reader&roles[]=writer')
      expect(result.status).toBe(200)
      expect(result.body.body).toEqual({ user: { name: 'Alice' }, roles: ['reader', 'writer'] })
    })

    it.each(['{', 'null', '42', '"scalar"'])(
      'rejects invalid or non-container JSON: %s',
      async (body) => {
        const result = await request(app.getHttpServer())
          .post('/api/v1/body-size/echo')
          .set('Content-Type', 'application/json')
          .send(body)
        expect(result.status).toBe(400)
        expect(result.body.errorCode).toBeUndefined()
      }
    )
  })
}
