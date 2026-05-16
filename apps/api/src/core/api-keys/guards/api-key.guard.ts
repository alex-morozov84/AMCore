import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import type { RequestPrincipal } from '@amcore/shared'

import { PrismaService } from '../../../prisma'
import { ApiKeyAbuseLimiterService } from '../api-key-abuse-limiter.service'
import { ApiKeysService } from '../api-keys.service'

@Injectable()
export class ApiKeyGuard implements CanActivate {
  // AK-08: only the `amcore_live_` prefix is accepted. `amcore_test_` was
  // historically matched here but never produced (no API path issued
  // test-mode keys), making the prefix a misleading no-op — any live key
  // would also authenticate when sent with the test_ spelling because
  // lookup is by shortToken alone. Real test mode is a future product
  // feature requiring data scope separation; until then live-only is the
  // honest contract.
  private static readonly API_KEY_PATTERN = /^amcore_live_([A-Za-z0-9_-]{11})_([A-Za-z0-9_-]{32})$/

  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly prisma: PrismaService,
    private readonly abuseLimiter: ApiKeyAbuseLimiterService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const parsed = this.parseApiKey(request)

    // Not our header (missing, JWT, or malformed prefix). The limiter is
    // intentionally not consulted here: pre-parse failures are too noisy
    // (typos, clients sending JWT) and the global ThrottlerGuard already
    // bounds per-IP request volume.
    if (!parsed) return false

    const ip = this.extractIp(request)
    const fingerprint = ApiKeyAbuseLimiterService.fingerprint(parsed.shortToken)

    // AK-07: throws 429 + RATE_LIMIT_EXCEEDED if either the per-IP or
    // per-fingerprint failure counter is at the limit. Propagates through
    // AuthenticationGuard (the api-key branch deliberately has no
    // try/catch — see AK-11). Order matters: check before any DB work so
    // a saturated IP cannot keep loading the database with hot-misses.
    await this.abuseLimiter.check(ip, fingerprint)

    const apiKey = await this.apiKeysService.verifyByShortToken(parsed.shortToken, parsed.longToken)

    if (!apiKey) {
      await this.abuseLimiter.consume(ip, fingerprint)
      return false
    }

    // Per ADR-033: API key principal must always carry org context.
    // Owner membership in the bound organization is re-verified on every
    // request — loss of membership or deletion of the organization
    // invalidates the credential (decision failure → 401 in the auth
    // chain). FK cascade also removes the key when the org is deleted,
    // but this lookup is robust to either ordering.
    const membership = await this.prisma.orgMember.findUnique({
      where: {
        userId_organizationId: {
          userId: apiKey.userId,
          organizationId: apiKey.organizationId,
        },
      },
      include: { organization: { select: { aclVersion: true } } },
    })

    if (!membership) {
      await this.abuseLimiter.consume(ip, fingerprint)
      return false
    }

    // Success — clear the fingerprint counter so brief integration churn
    // (e.g. a CI run with one bad attempt before fixing the key) doesn't
    // accumulate forever. IP counter intentionally stays — a single valid
    // key must not whitewash unrelated bad attempts from the same source.
    await this.abuseLimiter.reset(fingerprint)

    const principal: RequestPrincipal = {
      type: 'api_key',
      sub: apiKey.userId,
      systemRole: apiKey.user.systemRole,
      organizationId: apiKey.organizationId,
      aclVersion: membership.organization.aclVersion,
      scopes: apiKey.scopes,
    }

    request.user = principal

    void this.apiKeysService.touchLastUsed(apiKey.id)

    return true
  }

  private parseApiKey(request: Request): { shortToken: string; longToken: string } | null {
    const authHeader = request.headers['authorization']

    if (!authHeader?.startsWith('Bearer amcore_')) return null

    const fullKey = authHeader.slice(7) // remove "Bearer "
    const match = ApiKeyGuard.API_KEY_PATTERN.exec(fullKey)

    if (!match) return null

    const shortToken = match[1]!
    const longToken = match[2]!

    return { shortToken, longToken }
  }

  /**
   * Use the direct socket peer IP. `req.ip` already respects `trust proxy`
   * if the app sets it (we don't, in the starter — see deployment docs
   * for proxy-aware configuration). Falling back to `socket.remoteAddress`
   * covers the rare null case; `'unknown'` keeps the limiter usable when
   * neither is available (Redis key is still well-formed).
   */
  private extractIp(request: Request): string {
    return request.ip ?? request.socket.remoteAddress ?? 'unknown'
  }
}
