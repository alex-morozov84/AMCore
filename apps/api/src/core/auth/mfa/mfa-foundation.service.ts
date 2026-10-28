import { Injectable, type OnModuleInit } from '@nestjs/common'

import { MFA_PROTOCOL_VERSION } from '@amcore/shared'

import { PrismaService } from '../../../prisma/index.js'

import { MfaEncryptionService } from './mfa-encryption.service.js'

/** Local startup validation never activates a protocol or attests the rest of a deployment. */
@Injectable()
export class MfaFoundationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: MfaEncryptionService
  ) {}

  async onModuleInit(): Promise<void> {
    const [protocol, factors, protectedAccounts] = await Promise.all([
      this.prisma.mfaProtocol.findUnique({ where: { id: 'platform' } }),
      this.prisma.mfaFactor.count(),
      this.prisma.mfaAccount.count({ where: { required: true } }),
    ])
    if (
      protocol &&
      (protocol.version !== MFA_PROTOCOL_VERSION ||
        !['prepared', 'active'].includes(protocol.state))
    )
      throw new Error('Unsupported MFA protocol version or state')
    if (protocol?.state === 'active') {
      this.encryption.assertReady()
      return
    }
    if (factors > 0 || protectedAccounts > 0)
      throw new Error('Protected MFA data requires the active deployment protocol')
  }
}
