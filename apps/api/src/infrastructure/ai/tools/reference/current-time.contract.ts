import { z } from 'zod'

import type { AiToolContract } from '../ai-tool.types'
import { NoDomainToolAuthority, NoDomainToolAuthorityModule } from '../no-domain-tool-authority'

import { AiToolRiskClass } from '@/generated/prisma/client'

const parameters = z.object({}).strict()
export const currentTimeContract: AiToolContract<Record<string, never>> = {
  toolId: 'current_time',
  contractVersion: 1,
  displayName: 'Current time',
  description:
    'Returns the current date and time in UTC as an ISO-8601 string. Takes no arguments.',
  parameters,
  normalizedSchema: parameters,
  riskClass: AiToolRiskClass.SAFE,
  idempotency: 'read_only',
  authority: { module: NoDomainToolAuthorityModule, token: NoDomainToolAuthority },
}
