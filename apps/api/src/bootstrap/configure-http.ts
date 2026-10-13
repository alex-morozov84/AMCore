import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { Request, Response } from 'express'

import { createBullBoardEdgeGuard } from '../infrastructure/queue/dashboard/bull-board-edge.middleware'
import { BULL_BOARD_MOUNT } from '../infrastructure/queue/dashboard/bull-board-mount-state'

import { configureFastifyBodyParser } from './configure-fastify-body-parser'

/** Production HTTP bootstrap shared with E2E fixtures, before routes are registered. */
export async function configureHttp(
  app: NestFastifyApplication,
  prefix: string,
  security = false
): Promise<void> {
  if (BULL_BOARD_MOUNT.mounted) {
    const edge = createBullBoardEdgeGuard()
    const mount = `${prefix}/admin/queues`
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', (request, reply, done) => {
        const path = request.url.split('?')[0]?.toLowerCase() ?? ''
        if (path !== mount && !path.startsWith(`${mount}/`)) return done()
        let advanced = false
        edge(request.raw as unknown as Request, reply.raw as unknown as Response, () => {
          advanced = true
          done()
        })
        if (!advanced) reply.hijack()
      })
  }
  await configureFastifyBodyParser(app, prefix)
  await app.register(fastifyCookie)
  if (security) {
    await app.register(fastifyHelmet, { global: false })
    // Match the retained bootstrap: parser refusals precede Helmet.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('preValidation', async (_request, reply) => {
        await reply.helmet()
      })
  }
}
