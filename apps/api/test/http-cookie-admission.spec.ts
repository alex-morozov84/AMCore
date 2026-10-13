import type { Server } from 'node:http'

import fastifyCookie from '@fastify/cookie'
import { Controller, Get, Module, Res } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { Response } from 'express'
import request from 'supertest'

import { setOAuthBindingCookie } from '../src/core/auth/oauth/oauth-binding-cookie'

class CookieProbeController {
  get(res: Response) {
    // The experiment selects each adapter's documented cookie unit explicitly.
    const unit = 'raw' in res ? 'seconds' : 'milliseconds'
    setOAuthBindingCookie(res, 'google', 'probe-nonce', true, unit)
    res.send({ ok: true })
  }
}
Controller('cookie-probe')(CookieProbeController)
Get()(
  CookieProbeController.prototype,
  'get',
  Object.getOwnPropertyDescriptor(CookieProbeController.prototype, 'get')!
)
Res()(CookieProbeController.prototype, 'get', 0)
class CookieProbeModule {}
Module({ controllers: [CookieProbeController] })(CookieProbeModule)

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  [
    'fastify',
    () => {
      const adapter = new FastifyAdapter<Server>()
      adapter.getInstance().register(fastifyCookie)
      return adapter
    },
  ],
] as const) {
  describe(`HTTP admission: unchanged OAuth nonce on ${name}`, () => {
    it('keeps the browser-binding cookie at five minutes', async () => {
      const adapter = makeAdapter()
      const app = await NestFactory.create(CookieProbeModule, adapter, { logger: false })
      try {
        await app.init()
        if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
        const result = await request(app.getHttpServer()).get('/cookie-probe')
        expect(result.status).toBe(200)
        const cookie = result.headers['set-cookie']?.[0]
        if (!cookie) throw new Error('Missing binding cookie')
        expect(cookie).toContain('Max-Age=300;')
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('Secure')
        expect(cookie.toLowerCase()).toContain('samesite=lax')
      } finally {
        await app.close()
      }
    })
  })
}
