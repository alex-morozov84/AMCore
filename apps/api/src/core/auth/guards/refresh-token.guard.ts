import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'

import { SessionService } from '../session.service'
import { TokenService } from '../token.service'

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
      throw new UnauthorizedException('Refresh token отсутствует')
    }

    const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
    const session = await this.sessionService.findByRefreshToken(hashedToken)

    if (!session) {
      throw new UnauthorizedException('Сессия не найдена или истекла')
    }

    if (session.expiresAt < new Date()) {
      await this.sessionService.deleteByRefreshToken(hashedToken)
      throw new UnauthorizedException('Refresh token истёк')
    }

    // Присваиваем user и refreshTokenHash к request для использования в контроллере
    request.user = {
      user: session.user,
      refreshTokenHash: hashedToken,
    }

    return true
  }
}
