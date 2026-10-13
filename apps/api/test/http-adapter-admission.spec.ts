import { Controller, Get, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import request from 'supertest'

import { createBullBoardEdgeGuard } from '../src/infrastructure/queue/dashboard/bull-board-edge.middleware'

class ProbeController {
  get() {
    return { ok: true }
  }
}
Controller('probe')(ProbeController)
Get()(
  ProbeController.prototype,
  'get',
  Object.getOwnPropertyDescriptor(ProbeController.prototype, 'get')!
)
class ProbeModule {}
Module({ controllers: [ProbeController] })(ProbeModule)

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => new FastifyAdapter()],
] as const) {
  describe(`HTTP admission: unchanged queue edge on ${name}`, () => {
    it('returns board 405 before parsing malformed JSON', async () => {
      const adapter = makeAdapter()
      const app = await NestFactory.create(ProbeModule, adapter, {
        logger: false,
        bodyParser: false,
      })
      try {
        app.use('/api/v1/admin/queues', createBullBoardEdgeGuard())
        await app.init()
        if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
        const result = await request(app.getHttpServer())
          .post('/api/v1/admin/queues')
          .set('Content-Type', 'application/json')
          .send('{')
        expect(result.status).toBe(405)
        expect(result.headers.allow).toBe('GET, HEAD')
        expect(result.headers['cache-control']).toBe('private, no-store')
        expect(result.headers['access-control-allow-origin']).toBeUndefined()
      } finally {
        await app.close()
      }
    })
  })
}
