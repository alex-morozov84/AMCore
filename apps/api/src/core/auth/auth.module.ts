import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'

import { EnvModule } from '../../env/env.module'
import { EnvService } from '../../env/env.service'
import { EmailModule } from '../../infrastructure/email'
import { PrismaModule } from '../../prisma'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AbilityFactory } from './casl/ability.factory'
import {
  AuthenticationGuard,
  JwtAuthGuard,
  PoliciesGuard,
  RefreshTokenGuard,
  SystemRolesGuard,
} from './guards'
import { PermissionsCacheService } from './permissions-cache.service'
import { SessionService } from './session.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { TokenService } from './token.service'
import { TokenManagerService } from './token-manager.service'
import { UserCacheService } from './user-cache.service'

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    EmailModule,
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
    // RBAC
    AbilityFactory,
    PermissionsCacheService,
    JwtAuthGuard,
    PoliciesGuard,
    SystemRolesGuard,
    AuthenticationGuard,
    // Single global guard: authenticate → build ability → authorize
    // Registered in AuthModule so it runs AFTER ThrottlerGuard (AppModule)
    { provide: APP_GUARD, useClass: AuthenticationGuard },
  ],
  exports: [AuthService, UserCacheService, AbilityFactory, TokenService],
})
export class AuthModule {}
