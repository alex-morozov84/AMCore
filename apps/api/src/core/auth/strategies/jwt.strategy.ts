import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import type { User } from '@prisma/client'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { EnvService } from '../../../env/env.service'
import type { AccessTokenPayload } from '../token.service'
import { UserCacheService } from '../user-cache.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    env: EnvService,
    private readonly userCache: UserCacheService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.get('JWT_SECRET'),
    })
  }

  async validate(payload: AccessTokenPayload): Promise<User> {
    // Use cache-first approach instead of direct DB query
    const user = await this.userCache.getUser(payload.sub)

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден')
    }

    return user
  }
}
