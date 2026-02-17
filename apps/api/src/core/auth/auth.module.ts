import { Module } from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'

import { EnvModule } from '../../env/env.module'
import { EnvService } from '../../env/env.service'
import { PrismaModule } from '../../prisma'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { RefreshTokenGuard } from './guards'
import { SessionService } from './session.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { TokenService } from './token.service'
import { TokenManagerService } from './token-manager.service'
import { UserCacheService } from './user-cache.service'

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService): JwtModuleOptions => ({
        secret: env.get('JWT_SECRET'),
        signOptions: {
          expiresIn: env.get('JWT_ACCESS_EXPIRATION'),
        } as JwtModuleOptions['signOptions'],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    TokenManagerService,
    SessionService,
    JwtStrategy,
    RefreshTokenGuard,
    UserCacheService,
  ],
  exports: [AuthService, UserCacheService],
})
export class AuthModule {}
