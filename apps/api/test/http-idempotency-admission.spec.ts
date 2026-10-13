import { Body, Controller, HttpException, Module, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { PinoLogger } from 'nestjs-pino'
import request from 'supertest'

import { createHttpAdapter } from '../src/bootstrap/create-http-adapter'
import { EnvService } from '../src/env/env.service'
import { IdempotencyStoreService } from '../src/infrastructure/idempotency/idempotency-store.service'
import { Idempotent } from '../src/infrastructure/idempotency/idempotent.decorator'

const store = { reserve: jest.fn(), complete: jest.fn() }
let executions = 0
const values: Record<string, unknown> = {
  IDEMPOTENCY_FAIL_MODE: 'closed',
  IDEMPOTENCY_LOCK_TTL_SECONDS: 30,
  IDEMPOTENCY_REDIS_TIMEOUT_MS: 1000,
  IDEMPOTENCY_RETENTION_SECONDS: 86400,
}
@Controller('idempotency-probe')
class ProbeController {
  @Post()
  @Idempotent({ scope: 'probe' })
  create(@Body() body: { fail?: boolean }): { ok: boolean } {
    executions++
    if (body.fail) throw new HttpException({ error: 'probe failure' }, 503)
    return { ok: true }
  }
}
@Module({
  controllers: [ProbeController],
  providers: [
    { provide: EnvService, useValue: { get: (name: string) => values[name] } },
    { provide: IdempotencyStoreService, useValue: store },
    { provide: PinoLogger, useValue: { setContext: jest.fn(), warn: jest.fn() } },
  ],
})
class ProbeModule {}

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => createHttpAdapter()],
] as const) {
  describe(`HTTP idempotency commit/replay: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    beforeAll(async () => {
      const adapter = makeAdapter()
      app = await NestFactory.create(ProbeModule, adapter, { logger: false, abortOnError: false })
      await app.init()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    afterAll(async () => {
      if (app) await app.close()
    })
    beforeEach(() => {
      executions = 0
      store.reserve.mockReset().mockResolvedValue({
        kind: 'started',
        storageKey: 'probe-key',
        ownerToken: 'probe-owner',
      })
      store.complete.mockReset().mockResolvedValue(true)
    })
    const send = (body = {}) =>
      request(app.getHttpServer())
        .post('/idempotency-probe')
        .set('Idempotency-Key', 'probe-key')
        .send(body)

    it('waits for completion before flushing the first response', async () => {
      let release!: () => void
      let entered!: () => void
      const captured = new Promise<void>((resolve) => {
        entered = resolve
      })
      store.complete.mockImplementation(() => {
        entered()
        return new Promise<void>((resolve) => {
          release = resolve
        })
      })
      let settled = false
      const response = send().then((result) => {
        settled = true
        return result
      })
      await captured
      expect(settled).toBe(false)
      release()
      const result = await response
      expect(result.status).toBe(201)
      expect(store.complete).toHaveBeenCalledTimes(1)
      expect(store.complete.mock.calls[0][3]).toEqual({
        status: 201,
        body: result.text,
        headers: { 'content-type': result.headers['content-type'] },
      })
    })
    it('replays exact stored bytes and status without executing', async () => {
      store.reserve.mockResolvedValue({
        kind: 'replay',
        response: {
          status: 202,
          body: '{"ok":true}',
          headers: { 'content-type': 'application/json' },
        },
      })
      const result = await send()
      expect(result.status).toBe(202)
      expect(result.text).toBe('{"ok":true}')
      expect(result.headers['idempotency-replayed']).toBe('true')
      expect(result.headers['content-type']).toMatch(/^application\/json/)
      expect(executions).toBe(0)
      expect(store.complete).not.toHaveBeenCalled()
    })
    it('captures a filtered failure once', async () => {
      const result = await send({ fail: true })
      expect(result.status).toBe(503)
      expect(store.complete).toHaveBeenCalledTimes(1)
      expect(store.complete.mock.calls[0][3].body).toBe(result.text)
      expect(store.complete.mock.calls[0][3].status).toBe(503)
    })
    it.each([
      ['conflict', 409],
      ['mismatch', 422],
    ] as const)('refuses %s before executing', async (kind, status) => {
      store.reserve.mockResolvedValue({ kind })
      expect((await send()).status).toBe(status)
      expect(executions).toBe(0)
      expect(store.complete).not.toHaveBeenCalled()
    })
    it('still sends after completion fails', async () => {
      store.complete.mockRejectedValue(new Error('fixture store unavailable'))
      expect((await send()).status).toBe(201)
      expect(store.complete).toHaveBeenCalledTimes(1)
    })
  })
}
