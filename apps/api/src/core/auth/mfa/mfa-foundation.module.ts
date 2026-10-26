import { Module } from '@nestjs/common'

import { EnvModule } from '../../../env/env.module.js'
import { PrismaModule } from '../../../prisma/index.js'

import { MfaEncryptionService } from './mfa-encryption.service.js'
import { MfaFoundationService } from './mfa-foundation.service.js'
import { MfaProofRepository } from './mfa-proof.repository.js'

/** No HTTP controllers, enrollment, publication or activation surface at this stage. */
@Module({
  imports: [EnvModule, PrismaModule],
  providers: [MfaFoundationService, MfaEncryptionService, MfaProofRepository],
  exports: [MfaEncryptionService, MfaProofRepository],
})
export class MfaFoundationModule {}
