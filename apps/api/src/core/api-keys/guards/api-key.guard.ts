import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import type { RequestPrincipal } from '@amcore/shared'

import { PrismaService } from '../../../prisma'
import { ApiKeysService } from '../api-keys.service'

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private static readonly API_KEY_PATTERN =
    /^amcore_(live|test)_([A-Za-z0-9_-]{11})_([A-Za-z0-9_-]{32})$/

  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const parsed = this.parseApiKey(request)

    if (!parsed) return false

    const apiKey = await this.apiKeysService.verifyByShortToken(parsed.shortToken, parsed.longToken)

    if (!apiKey) return false

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

    if (!membership) return false

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

    const shortToken = match[2]!
    const longToken = match[3]!

    return { shortToken, longToken }
  }
}
