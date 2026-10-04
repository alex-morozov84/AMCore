import type { NestExpressApplication } from '@nestjs/platform-express'

import { createBullBoardEdgeGuard } from '../infrastructure/queue/dashboard/bull-board-edge.middleware'
import { BULL_BOARD_MOUNT } from '../infrastructure/queue/dashboard/bull-board-mount-state'

/**
 * Register the board's outermost guard on its mount path, when the board is mounted at all. Call it
 * BEFORE the body parser, Helmet and CORS: those answer some requests (a malformed body, a
 * preflight) before the board's own middleware chain would see them. `prefix` is the global API
 * prefix with a leading slash (`''` when the application has none, as in the e2e bootstrap).
 */
export function configureBullBoardEdge(app: NestExpressApplication, prefix = '/api/v1'): void {
  if (BULL_BOARD_MOUNT.mounted) app.use(`${prefix}/admin/queues`, createBullBoardEdgeGuard())
}
