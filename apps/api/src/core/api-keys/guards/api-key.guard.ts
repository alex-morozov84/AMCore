import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import type { RequestPrincipal } from '@amcore/shared'

import { ApiKeysService } from '../api-keys.service'

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private static readonly API_KEY_PATTERN =
    /^amcore_(live|test)_([A-Za-z0-9_-]{11})_([A-Za-z0-9_-]{32})$/

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
    const match = ApiKeyGuard.API_KEY_PATTERN.exec(fullKey)

    if (!match) return null

    const shortToken = match[2]!
    const longToken = match[3]!

    return { shortToken, longToken }
  }
}
