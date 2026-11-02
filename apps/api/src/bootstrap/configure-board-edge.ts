import type { Request, Response } from 'express'
import type { FastifyInstance } from 'fastify'

import { createBullBoardEdgeGuard } from '../infrastructure/queue/dashboard/bull-board-edge.middleware.js'

/** Install before Nest constructs its CORS hook, so preflights retain the board refusal. */
export function configureBoardEdge(instance: FastifyInstance, mount: string): void {
  const edge = createBullBoardEdgeGuard()
  const classificationMount = mount.toLowerCase()
  instance.addHook('onRequest', (request, reply, done) => {
    const path = request.url.split('?')[0]?.toLowerCase() ?? ''
    if (path !== classificationMount && !path.startsWith(`${classificationMount}/`)) return done()
    let advanced = false
    edge(request.raw as unknown as Request, reply.raw as unknown as Response, () => {
      advanced = true
      done()
    })
    if (!advanced) reply.hijack()
  })
}
