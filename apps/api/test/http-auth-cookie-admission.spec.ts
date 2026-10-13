import type { Server } from 'node:http'

import fastifyCookie from '@fastify/cookie'
import { Controller, Get, Module, Param, Post, Req, Res } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import cookieParser from 'cookie-parser'
import type { Request, Response } from 'express'
import request from 'supertest'

import { AuthController } from '../src/core/auth/auth.controller'
import { OAuthController } from '../src/core/auth/oauth/oauth.controller'
import type { EnvService } from '../src/env/env.service'

const env = { get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined) } as EnvService
const auth = new AuthController(
  {
    login: async () => ({
      refreshToken: 'fixture-refresh',
      user: {},
      accessToken: 'fixture-access',
    }),
    logout: async () => undefined,
  } as never,
  {} as never,
  {} as never,
  { hashRefreshToken: () => 'fixture-hash' } as never,
  env
)
const oauth = new OAuthController(
  {
    getAuthorizationURL: async () => ({
      url: 'https://provider.example.test/authorize',
      browserNonce: 'fixture-nonce',
    }),
  } as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  env
)

// Delegate to real methods; service fixtures isolate cookie transport from DB/provider behavior.
@Controller('auth-cookie-probe')
class ProbeController {
  @Post('login')
  login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return auth.login({ email: 'probe@example.test', password: '<fixture-password>' }, req, res)
  }
  @Post('logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return auth.logout(req, res)
  }
  @Get('oauth/:provider')
  authorize(@Param('provider') provider: string, @Req() req: Request, @Res() res: Response) {
    return oauth.authorize(provider, req, res)
  }
}
@Module({ controllers: [ProbeController] })
class ProbeModule {}

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => new FastifyAdapter<Server>()],
] as const) {
  describe(`HTTP production auth cookie methods: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    beforeAll(async () => {
      const adapter = makeAdapter()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().register(fastifyCookie)
      app = await NestFactory.create(ProbeModule, adapter, { logger: false, abortOnError: false })
      if (adapter instanceof ExpressAdapter) app.use(cookieParser())
      await app.init()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    afterAll(async () => {
      if (app) await app.close()
    })
    it('sets refresh cookie for seven days with production flags', async () => {
      const result = await request(app.getHttpServer()).post('/auth-cookie-probe/login')
      expect(result.status).toBe(201)
      const cookie = result.headers['set-cookie']?.[0]
      expect(cookie).toContain('Max-Age=604800;')
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('Secure')
      expect(cookie).toMatch(/SameSite=Strict/i)
      expect(cookie).toContain('Path=/;')
    })
    it('clears the refresh cookie at its original path', async () => {
      const result = await request(app.getHttpServer())
        .post('/auth-cookie-probe/logout')
        .set('Cookie', 'refresh_token=fixture-refresh')
      expect(result.status).toBe(201)
      const cookie = result.headers['set-cookie']?.[0]
      expect(cookie).toContain('refresh_token=;')
      expect(cookie).toContain('Path=/;')
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    })
    it.each(['google', 'apple'])(
      'keeps %s binding cookie lifetime and redirect',
      async (provider) => {
        const result = await request(app.getHttpServer()).get(
          `/auth-cookie-probe/oauth/${provider}`
        )
        expect(result.status).toBe(302)
        expect(result.headers.location).toBe('https://provider.example.test/authorize')
        const cookie = result.headers['set-cookie']?.[0]
        expect(cookie).toContain('Max-Age=300;')
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('Secure')
        expect(cookie).toMatch(provider === 'apple' ? /SameSite=None/i : /SameSite=Lax/i)
        expect(cookie).toContain(
          provider === 'apple' ? 'Path=/api/v1/auth/oauth/apple/callback;' : 'Path=/;'
        )
      }
    )
  })
}
