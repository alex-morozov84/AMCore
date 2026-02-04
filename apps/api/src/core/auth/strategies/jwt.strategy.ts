import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import type { User } from '@prisma/client'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { EnvService } from '../../../env/env.service'
import { PrismaService } from '../../../prisma'
import type { AccessTokenPayload } from '../token.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    env: EnvService,
    private readonly prisma: PrismaService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.get('JWT_SECRET'),
    })
  }

  async validate(payload: AccessTokenPayload): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    })

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден')
    }

    return user
  }
}
