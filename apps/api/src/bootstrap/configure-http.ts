import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { configureFastifyBodyParser } from './configure-fastify-body-parser.js'

/** Production HTTP bootstrap shared with E2E fixtures, before routes are registered. */
export async function configureHttp(
  app: NestFastifyApplication,
  prefix: string,
  security = false
): Promise<void> {
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
