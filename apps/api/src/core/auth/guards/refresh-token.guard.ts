import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import type { Request } from 'express'

import { UnauthorizedException } from '../../../common/exceptions/index.js'
import { browserSessionContext } from '../../frontend-context/browser-session-context.service.js'
import { refreshSessionChanged } from '../mfa/mfa-refresh-authority.js'
import { SessionService } from '../session.service.js'
import { TokenService } from '../token.service.js'

/**
 * Guard для валидации refresh token из cookie
 * Используется только для /auth/refresh эндпоинта
 */
@Injectable()
export class RefreshTokenGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const refreshToken = request.cookies?.refresh_token

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is missing')
    }

    const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
    const browser = browserSessionContext(request)
    if (browser && !browser.binding) throw refreshSessionChanged()
    const session = await this.sessionService.validateRefreshToken(
      hashedToken,
      browser?.binding ?? null
    )

    // Присваиваем user и refreshTokenHash к request для использования в контроллере
    request.user = {
      user: session.user,
      refreshTokenHash: hashedToken,
    }

    return true
  }
}
