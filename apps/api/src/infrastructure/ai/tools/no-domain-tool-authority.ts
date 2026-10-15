import { Injectable, Module } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client.js'

import type { AiToolAuthority, AiToolIntent } from './ai-tool.types.js'

/** Explicit authority for the reference read-only tool that touches no domain resource. */
@Injectable()
export class NoDomainToolAuthority implements AiToolAuthority {
  async canDisclose(_tx: Prisma.TransactionClient, intent: AiToolIntent): Promise<boolean> {
    return (
      intent.target === null && intent.riskClass === 'SAFE' && intent.idempotency === 'read_only'
    )
  }

  async authorize(tx: Prisma.TransactionClient, intent: AiToolIntent): Promise<void> {
    if (!(await this.canDisclose(tx, intent))) throw new Error('tool_domain_authorization_required')
  }
}

@Module({ providers: [NoDomainToolAuthority], exports: [NoDomainToolAuthority] })
export class NoDomainToolAuthorityModule {}
