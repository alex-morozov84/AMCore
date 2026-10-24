import { Module } from '@nestjs/common'

import { EnvModule } from '../../env/env.module.js'
import { PrismaModule } from '../../prisma/index.js'

import { AuthMailLimiter } from './auth-mail-limiter.service.js'
import { TokenManagerService } from './token-manager.service.js'

/** No AuthModule import: admin and public auth share these leaf capabilities. */
@Module({
  imports: [EnvModule, PrismaModule],
  providers: [AuthMailLimiter, TokenManagerService],
  exports: [AuthMailLimiter, TokenManagerService],
})
export class AuthMailModule {}
