import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'

import { configureBodyParser } from './support/express-body-parser'

class ParserProbeModule {}
Module({})(ParserProbeModule)

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => new FastifyAdapter()],
] as const) {
  describe(`HTTP admission: unchanged parser setup on ${name}`, () => {
    it('documents the Express-only parser API; native budgets use a separate setup', async () => {
      const adapter = makeAdapter()
      const app = await NestFactory.create(ParserProbeModule, adapter, {
        logger: false,
        rawBody: true,
        abortOnError: false,
      })
      try {
        let failure: unknown
        try {
          configureBodyParser(app as NestExpressApplication)
        } catch (error) {
          failure = error
        }
        const expected = { express: undefined, fastify: 'FST_ERR_CTP_INVALID_TYPE' }
        expect((failure as { code?: string } | undefined)?.code).toBe(expected[name])
      } finally {
        await app.close()
      }
    })
  })
}
