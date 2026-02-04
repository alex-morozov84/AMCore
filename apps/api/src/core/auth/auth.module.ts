import { Module } from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'

import { EnvModule } from '../../env/env.module'
import { EnvService } from '../../env/env.service'
import { PrismaModule } from '../../prisma'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { SessionService } from './session.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy'
import { TokenService } from './token.service'

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
  providers: [AuthService, TokenService, SessionService, JwtStrategy, JwtRefreshStrategy],
  exports: [AuthService],
})
export class AuthModule {}
