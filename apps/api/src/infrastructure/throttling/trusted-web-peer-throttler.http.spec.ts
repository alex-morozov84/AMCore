import { Controller, Get, type INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'

import { resolveTrustedWebPeers } from '../../common/utils/trusted-web-peer'
import { EnvService } from '../../env/env.service'

import { TrustedWebPeerThrottlerGuard } from './trusted-web-peer-throttler.guard'

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return { ok: true }
  }
}

/** Real Nest app, real ThrottlerModule (in-memory storage — the Redis
 * storage's own semantics are already covered by throttler-storage.e2e-spec.ts;
 * this test is specifically about the guard's tracker/peer-verification
 * behavior), real HTTP over a real loopback socket via supertest. */
async function buildApp(trustedWebPeersRaw: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 2 }] }),
    ],
    controllers: [PingController],
    providers: [
      { provide: APP_GUARD, useClass: TrustedWebPeerThrottlerGuard },
      { provide: EnvService, useValue: { get: () => resolveTrustedWebPeers(trustedWebPeersRaw) } },
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('TrustedWebPeerThrottlerGuard — real ThrottlerModule + HTTP (ADR-072)', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    // Always close, even when an assertion above throws — otherwise a
    // failing test leaks an open HTTP server handle into the next run.
    await app?.close()
    app = undefined
  })

  it('buckets every caller by req.ip when TRUSTED_WEB_PEERS is disabled — identical to the stock guard', async () => {
    app = await buildApp('')
    const server = app.getHttpServer()

    // limit=2: three real requests over the same loopback socket, each
    // claiming a DIFFERENT client-IP, must still share one bucket and 429
    // on the third — proves the header has zero effect while disabled.
    await request(server).get('/ping').set('x-amcore-client-ip', '1.1.1.1').expect(200)
    await request(server).get('/ping').set('x-amcore-client-ip', '2.2.2.2').expect(200)
    await request(server).get('/ping').set('x-amcore-client-ip', '3.3.3.3').expect(429)
  })

  it('tracks each claimed client-IP separately once TRUSTED_WEB_PEERS trusts the real (loopback) peer', async () => {
    app = await buildApp('loopback')
    const server = app.getHttpServer()

    // limit=2 per distinct tracker: three distinct client-IPs each get their
    // own budget, so none of them individually crosses the limit.
    await request(server).get('/ping').set('x-amcore-client-ip', '1.1.1.1').expect(200)
    await request(server).get('/ping').set('x-amcore-client-ip', '2.2.2.2').expect(200)
    await request(server).get('/ping').set('x-amcore-client-ip', '3.3.3.3').expect(200)
  })

  it('ignores the header when TRUSTED_WEB_PEERS does not cover the real peer — proves the guard fails safe', async () => {
    // Configured, but NOT covering loopback (the real test peer) — the same
    // shape as an operator misconfiguring the trusted subnet.
    app = await buildApp('10.0.0.0/8')
    const server = app.getHttpServer()

    await request(server).get('/ping').set('x-amcore-client-ip', '1.1.1.1').expect(200)
    await request(server).get('/ping').set('x-amcore-client-ip', '2.2.2.2').expect(200)
    await request(server).get('/ping').set('x-amcore-client-ip', '3.3.3.3').expect(429)
  })
})
