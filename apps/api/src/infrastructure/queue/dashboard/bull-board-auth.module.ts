import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

import { PrivilegedAdmissionService } from '../../../core/auth/privileged-admission.service.js'
import { PrivilegedRoleService } from '../../../core/auth/privileged-role.service.js'
import { EnvModule } from '../../../env/env.module.js'
import { EnvService } from '../../../env/env.service.js'

import { BullBoardAuthService } from './bull-board-auth.service.js'
import { BullBoardBearerAuthService } from './bull-board-bearer-auth.service.js'

/**
 * Provides the read-only Bull Board access verifiers to the dynamically created Bull Board module
 * via `BullBoardModule.forRootAsync({ imports })`: the browser-cookie verifier (direct access) and
 * the bearer verifier (the Console BFF).
 *
 * Deliberately independent of `AuthModule` — importing it here would close a `QueueModule →
 * AuthModule → EmailModule → QueueModule` cycle. It needs only the global `PrismaService`, the shared
 * hash helper, a verify-only `JwtModule` (the same `JWT_SECRET`) and the two stateless privileged-role
 * providers, so the admission rule itself is the one `AuthModule` uses.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({ secret: env.get('JWT_SECRET') }),
    }),
  ],
  providers: [
    BullBoardAuthService,
    BullBoardBearerAuthService,
    PrivilegedRoleService,
    PrivilegedAdmissionService,
  ],
  exports: [BullBoardAuthService, BullBoardBearerAuthService],
})
export class BullBoardAuthModule {}
