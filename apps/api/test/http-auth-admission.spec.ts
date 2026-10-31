import type { Server } from 'node:http'

import fastifyCookie from '@fastify/cookie'
import { Controller, Get, Module, Post, Req, UseGuards } from '@nestjs/common'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import cookieParser from 'cookie-parser'
import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'
import request from 'supertest'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { AllExceptionsFilter } from '../src/common/exceptions/filters/all-exceptions.filter'
import { HttpExceptionFilter } from '../src/common/exceptions/filters/http-exception.filter'
import { CurrentUser } from '../src/core/auth/decorators/current-user.decorator'
import { JwtAuthGuard } from '../src/core/auth/guards/jwt-auth.guard'
import { OriginCheckGuard } from '../src/core/auth/guards/origin-check.guard'
import { RefreshTokenGuard } from '../src/core/auth/guards/refresh-token.guard'
import { MfaAuthorityReader } from '../src/core/auth/mfa/mfa-authority-reader.service.js'
import { PrivilegedRoleService } from '../src/core/auth/privileged-role.service'
import { SessionService } from '../src/core/auth/session.service'
import { JwtStrategy } from '../src/core/auth/strategies/jwt.strategy'
import { TokenService } from '../src/core/auth/token.service'
import { EnvService } from '../src/env/env.service'

const secret = '<http-admission-test-secret>'
const validateRefreshToken = jest.fn(async (hash: string) => ({ user: { id: 'probe' }, hash }))
@Controller('auth-probe')
class AuthProbeController {
  @Get('jwt')
  @UseGuards(JwtAuthGuard)
  jwt(@CurrentUser() user: RequestPrincipal) {
    return { sub: user.sub, role: user.systemRole }
  }

  @Post('refresh')
  @UseGuards(OriginCheckGuard, RefreshTokenGuard)
  refresh(@Req() req: { user: { user: { id: string }; refreshTokenHash: string } }) {
    return { sub: req.user.user.id, hash: req.user.refreshTokenHash }
  }
}
@Module({
  imports: [JwtModule.register({ secret })],
  controllers: [AuthProbeController],
  providers: [
    JwtStrategy,
    {
      provide: MfaAuthorityReader,
      useValue: {
        readPrimaryProjection: () => {
          throw new Error('Ordinary Passport probe must not select protected primary authority')
        },
      },
    },
    JwtAuthGuard,
    OriginCheckGuard,
    RefreshTokenGuard,
    TokenService,
    {
      provide: EnvService,
      useValue: { get: (key: string) => (key === 'JWT_SECRET' ? secret : ['https://web.example']) },
    },
    {
      provide: PrivilegedRoleService,
      useValue: {
        getCurrentSystemRole: async (sub: string) => (sub === 'probe' ? SystemRole.User : null),
      },
    },
    { provide: SessionService, useValue: { validateRefreshToken } },
  ],
})
class AuthProbeModule {}

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => new FastifyAdapter<Server>()],
] as const) {
  describe(`HTTP production Passport/cookie/origin guards: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    let jwt: JwtService
    beforeAll(async () => {
      const adapter = makeAdapter()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().register(fastifyCookie)
      app = await NestFactory.create(AuthProbeModule, adapter, {
        logger: false,
        abortOnError: false,
      })
      if (adapter instanceof ExpressAdapter) app.use(cookieParser())
      const logger = {
        setContext: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      } as unknown as PinoLogger
      const host = app.get(HttpAdapterHost)
      const cls = { getId: () => 'probe' } as ClsService
      app.useGlobalFilters(
        new AllExceptionsFilter(host, logger, cls),
        new HttpExceptionFilter(logger, cls, host)
      )
      jwt = app.get(JwtService)
      await app.init()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    beforeEach(() => validateRefreshToken.mockClear())
    afterAll(async () => {
      if (app) await app.close()
    })

    it('verifies signed token and preserves principal through Passport and CurrentUser', async () => {
      const token = jwt.sign({ sub: 'probe', systemRole: SystemRole.User }, { expiresIn: 60 })
      const result = await request(app.getHttpServer())
        .get('/auth-probe/jwt')
        .auth(token, { type: 'bearer' })
      expect(result.status).toBe(200)
      expect(result.body).toEqual({ sub: 'probe', role: SystemRole.User })
    })
    it.each(['missing', 'invalid', 'expired', 'unknown'])('rejects %s bearer', async (kind) => {
      const token =
        kind === 'invalid'
          ? 'invalid-token'
          : jwt.sign(
              { sub: kind === 'unknown' ? 'unknown' : 'probe', systemRole: SystemRole.User },
              { expiresIn: kind === 'expired' ? -1 : 60 }
            )
      const call = request(app.getHttpServer()).get('/auth-probe/jwt')
      const result = await (kind === 'missing' ? call : call.auth(token, { type: 'bearer' }))
      expect(result.status).toBe(401)
    })
    it('parses refresh cookie and hashes it before session validation', async () => {
      const result = await request(app.getHttpServer())
        .post('/auth-probe/refresh')
        .set('Cookie', 'refresh_token=probe-refresh')
        .set('Origin', 'https://web.example')
      expect(result.status).toBe(201)
      const hash = app.get(TokenService).hashRefreshToken('probe-refresh')
      expect(validateRefreshToken).toHaveBeenCalledWith(hash, null)
      expect(result.body).toEqual({ sub: 'probe', hash })
    })
    it('rejects missing refresh cookie', async () => {
      const result = await request(app.getHttpServer()).post('/auth-probe/refresh')
      expect(result.status).toBe(401)
      expect(validateRefreshToken).not.toHaveBeenCalled()
    })
    it.each(['https://evil.example', 'invalid-origin'])(
      'rejects origin %s before session validation',
      async (origin) => {
        const result = await request(app.getHttpServer())
          .post('/auth-probe/refresh')
          .set('Cookie', 'refresh_token=probe-refresh')
          .set('Origin', origin)
        expect(result.status).toBe(403)
        expect(result.body.errorCode).toBe('AUTH_ORIGIN_REJECTED')
        expect(validateRefreshToken).not.toHaveBeenCalled()
      }
    )
  })
}
