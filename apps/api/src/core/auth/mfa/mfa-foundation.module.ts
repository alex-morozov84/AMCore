import { Module } from '@nestjs/common'

import { EnvModule } from '../../../env/env.module.js'
import { PrismaModule } from '../../../prisma/index.js'

import { MfaEncryptionService } from './mfa-encryption.service.js'
import { MfaFoundationService } from './mfa-foundation.service.js'
import { MfaProofRepository } from './mfa-proof.repository.js'

/** Shared local protocol/key startup fence for API and worker; activation remains deployment-owned. */
@Module({
  imports: [EnvModule, PrismaModule],
  providers: [MfaFoundationService, MfaEncryptionService, MfaProofRepository],
  exports: [MfaEncryptionService, MfaProofRepository],
})
export class MfaFoundationModule {}
