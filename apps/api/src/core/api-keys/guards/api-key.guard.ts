import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import type { RequestPrincipal } from '@amcore/shared'

import { ApiKeysService } from '../api-keys.service'

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const parsed = this.parseApiKey(request)

    if (!parsed) return false

    const apiKey = await this.apiKeysService.verifyByShortToken(parsed.shortToken, parsed.longToken)

    if (!apiKey) return false

    const principal: RequestPrincipal = {
      type: 'api_key',
      sub: apiKey.userId,
      systemRole: apiKey.user.systemRole,
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
    const parts = fullKey.split('_')

    // expected: ['amcore', 'live', shortToken, longToken]
    if (parts.length !== 4) return null

    return { shortToken: parts[2]!, longToken: parts[3]! }
  }
}
