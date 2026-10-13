import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { createHttpAdapter } from '../src/bootstrap/create-http-adapter'

/** Use the production Fastify parser and plugins in full API suites. */
export async function createHttpTestApp(
  module: TestingModule,
  prefix: string,
  security = false
): Promise<NestFastifyApplication> {
  // Helpers load before suite-owned environment setup; defer the frozen mount decision.
  const { configureHttp } = await import('../src/bootstrap/configure-http')
  const { BULL_BOARD_MOUNT } =
    await import('../src/infrastructure/queue/dashboard/bull-board-mount-state')
  const app = module.createNestApplication<NestFastifyApplication>(
    createHttpAdapter(`${prefix}/admin/queues`, false, BULL_BOARD_MOUNT.mounted),
    { rawBody: true }
  )
  await configureHttp(app, prefix, security)
  return app
}
