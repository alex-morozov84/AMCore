import { Injectable, Module } from '@nestjs/common'

import { EnvModule } from '../../../../env/env.module.js'
import { EnvService } from '../../../../env/env.service.js'
import { EmailModule } from '../../../../infrastructure/email/email.module.js'
import { PrismaModule } from '../../../../prisma/index.js'
import { AuditModule } from '../../../audit/index.js'
import { EmailTestProbe } from '../email-test/email-test.probe.js'
import { EmailTestStore } from '../email-test/email-test.store.js'
import type { IntegrationReader, IntegrationReading } from '../integration.types.js'

/** Email: provider mode and sender domain from configuration, plus the operator test evidence. */
@Injectable()
export class EmailIntegrationReader implements IntegrationReader {
  constructor(
    private readonly env: EnvService,
    private readonly probe: EmailTestProbe
  ) {}

  async read(): Promise<IntegrationReading> {
    const from = this.env.get('EMAIL_FROM')
    const domain = from.slice(from.lastIndexOf('@') + 1)
    return {
      configuration: 'configured',
      evidence: await this.probe.evidence(),
      facts: [
        { key: 'provider', value: this.probe.mode },
        ...(/^[A-Za-z0-9.-]{1,64}$/.test(domain) ? [{ key: 'sender_domain', value: domain }] : []),
      ],
      links: ['runbook'],
    }
  }
}

@Module({
  imports: [EnvModule, EmailModule, PrismaModule, AuditModule],
  providers: [EmailTestStore, EmailTestProbe, EmailIntegrationReader],
  exports: [EmailIntegrationReader, EmailTestProbe],
})
export class EmailIntegrationModule {}
