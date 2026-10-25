import { Controller, Get, Module, Req } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ExpressAdapter } from '@nestjs/platform-express'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import type { Request } from 'express'
import request from 'supertest'

import { AMCORE_CLIENT_IP_HEADER } from '@amcore/shared'

import { createHttpAdapter } from '../src/bootstrap/create-http-adapter'
import { resolveTrustedWebPeers } from '../src/common/utils/trusted-web-peer'
import {
  resolveSessionIpAddress,
  resolveVerifiedVisitorIp,
} from '../src/common/utils/verified-visitor-ip'
import type { EnvService } from '../src/env/env.service'
import { resolveTracker } from '../src/infrastructure/throttling/client-tracker'

@Controller('peer-probe')
class PeerProbeController {
  @Get()
  get(@Req() req: Request) {
    const peers = resolveTrustedWebPeers(req.headers['x-probe-trusted'] === 'yes' ? 'loopback' : '')
    const env = { get: () => peers } as unknown as EnvService
    return {
      session: resolveSessionIpAddress(req, env),
      password: resolveVerifiedVisitorIp(req, env) ?? req.ip ?? req.socket?.remoteAddress ?? '',
      tracker: resolveTracker(req, env),
      peer: req.socket.remoteAddress,
      ip: req.ip,
      protocol: req.protocol,
    }
  }
}

describe('HTTP configured proxy parity', () => {
  it.each([
    [1, '1.1.1.1'],
    [2, '9.9.9.9'],
    ['loopback', '1.1.1.1'],
    ['127.0.0.0/8,::1/128', '1.1.1.1'],
    ['192.0.2.0/24', null],
  ] as const)(
    'preserves trust setting %s and separate socket authority',
    async (trust, expected) => {
      for (const native of [false, true]) {
        const adapter = native ? createHttpAdapter('/board', trust) : new ExpressAdapter()
        if (adapter instanceof ExpressAdapter) adapter.getInstance().set('trust proxy', trust)
        const app = await NestFactory.create(PeerProbeModule, adapter, {
          logger: false,
          abortOnError: false,
        })
        try {
          await app.init()
          if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
          const result = await request(app.getHttpServer())
            .get('/peer-probe')
            .set('x-forwarded-for', '9.9.9.9, 1.1.1.1')
            .set('x-forwarded-proto', 'https')
            .set(AMCORE_CLIENT_IP_HEADER, '8.8.8.8')
          expect(result.status).toBe(200)
          expect(result.body.ip).toBe(expected ?? result.body.peer)
          expect(result.body.protocol).toBe(expected === null ? 'http' : 'https')
          // The untrusted BFF claim is ignored; the configured proxy-derived IP remains authoritative.
          expect(result.body.session).toBe(expected ?? result.body.peer)
          expect(result.body.tracker).toBe(expected ?? result.body.peer)
        } finally {
          await app.close()
        }
      }
    }
  )
})
@Module({ controllers: [PeerProbeController] })
class PeerProbeModule {}

for (const [name, makeAdapter] of [
  ['express', () => new ExpressAdapter()],
  ['fastify', () => new FastifyAdapter({ trustProxy: false })],
] as const) {
  describe(`HTTP actual socket trust: ${name}`, () => {
    let app: Awaited<ReturnType<typeof NestFactory.create>>
    beforeAll(async () => {
      const adapter = makeAdapter()
      app = await NestFactory.create(PeerProbeModule, adapter, { logger: false })
      await app.init()
      if (adapter instanceof FastifyAdapter) await adapter.getInstance().ready()
    })
    afterAll(async () => {
      if (app) await app.close()
    })
    it.each([
      ['no', '8.8.8.8', false],
      ['yes', '8.8.8.8', true],
      ['yes', '2001:4860:4860::8888', true],
      ['yes', '8.8.8.8, 1.1.1.1', false],
      ['yes', 'invalid', false],
    ])('validates allowlist=%s and claim=%s', async (trusted, claim, accepted) => {
      const result = await request(app.getHttpServer())
        .get('/peer-probe')
        .set('x-probe-trusted', trusted)
        .set(AMCORE_CLIENT_IP_HEADER, claim)
        .set('x-forwarded-for', '9.9.9.9')
      expect(result.status).toBe(200)
      expect(result.body.session).toBe(accepted ? claim : result.body.peer)
      expect(result.body.password).toBe(accepted ? claim : result.body.peer)
      expect(result.body.tracker).toBe(accepted ? claim : result.body.peer)
      expect(result.body.peer).not.toBe('9.9.9.9')
    })
  })
}

describe('password identity across actual IPv4/IPv6 web peers', () => {
  it('keeps one visitor identity across two peers and separates two visitors through one peer', async () => {
    const adapter = new FastifyAdapter({ trustProxy: false })
    const app = await NestFactory.create(PeerProbeModule, adapter, { logger: false })
    try {
      await app.listen(0, '::')
      const address = app.getHttpServer().address()
      if (!address || typeof address === 'string') throw new Error('Missing dual-stack listener')
      const via = async (host: string, claim: string) =>
        request(`http://${host}:${address.port}`)
          .get('/peer-probe')
          .set('x-probe-trusted', 'yes')
          .set(AMCORE_CLIENT_IP_HEADER, claim)
          .expect(200)
      const first = await via('127.0.0.1', '203.0.113.75')
      const second = await via('[::1]', '203.0.113.75')
      expect(first.body.peer).not.toBe(second.body.peer)
      expect(first.body.password).toBe('203.0.113.75')
      expect(second.body.password).toBe(first.body.password)
      const other = await via('127.0.0.1', '203.0.113.76')
      expect(other.body.peer).toBe(first.body.peer)
      expect(other.body.password).toBe('203.0.113.76')
    } finally {
      await app.close()
    }
  })
})
