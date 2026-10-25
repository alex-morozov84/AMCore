import { Injectable, type OnModuleInit } from '@nestjs/common'

import { PrismaService } from '../../../prisma/index.js'

/**
 * This deployment contains only dormant foundation. There is deliberately no
 * activation writer: a prepared schema must never masquerade as enforced MFA.
 */
@Injectable()
export class MfaFoundationService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const [protocol, factors, protectedAccounts] = await Promise.all([
      this.prisma.mfaProtocol.findUnique({ where: { id: 'platform' } }),
      this.prisma.mfaFactor.count(),
      this.prisma.mfaAccount.count({ where: { required: true } }),
    ])
    if ((protocol && protocol.state !== 'prepared') || factors > 0 || protectedAccounts > 0) {
      throw new Error('MFA-active data requires a complete MFA-capable deployment')
    }
    if (protocol && protocol.version !== 1) {
      throw new Error('Unsupported MFA protocol version')
    }
  }
}
