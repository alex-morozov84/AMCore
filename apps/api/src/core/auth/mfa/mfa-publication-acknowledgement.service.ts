import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { z } from 'zod'

import type { publicationAcknowledgeInputSchema } from '@amcore/shared'

import { AppException, ServiceUnavailableException } from '../../../common/exceptions/index.js'
import { PrismaService } from '../../../prisma/index.js'
import type { InvitationHandoffProof } from '../../invitations/invitation-auth-handoff.js'

import type { FlowRequest } from './mfa-flow-lock.js'
import { PublicationExpiredDuringCommit, settlePublication } from './mfa-publication-settlement.js'
import { PendingSessionProof } from './pending-session-proof.js'

/** Both transports use the same restricted validator and atomic settlement. No ordinary actor is created. */
@Injectable()
export class MfaPublicationAcknowledgementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async acknowledge(
    flow: FlowRequest,
    body: z.infer<typeof publicationAcknowledgeInputSchema>,
    handoff: InvitationHandoffProof | null = null
  ): Promise<{ outcome: 'published' }> {
    if (handoff && !flow.browser)
      throw new AppException('Browser publication required', 401, 'AUTH_CONTEXT_CHANGED')
    const proof = PendingSessionProof.verify(
      body.accessToken,
      this.jwt,
      handoff
        ? 'invitation_publication'
        : flow.browser
          ? 'browser_publication'
          : 'direct_mfa_receipt'
    )
    try {
      const result = await this.prisma.$transaction(
        (tx) =>
          settlePublication(tx, {
            proof,
            continuation: flow.credential,
            operationId: body.operationId,
            audience: flow.audience,
            bindingHash: flow.bindingHash,
            browser: flow.browser,
            vaultBinding: body.vaultBinding,
            receipt: body.receipt,
            handoff,
          }),
        { maxWait: 2000, timeout: 4000 }
      )
      if (result.outcome === 'unavailable') throw new ServiceUnavailableException('MFA unavailable')
      if (result.outcome !== 'published') throw changed()
      return { outcome: 'published' }
    } catch (error) {
      if (error instanceof PublicationExpiredDuringCommit) throw changed()
      throw error
    }
  }
}
function changed(): AppException {
  return new AppException(
    'Publication changed; do not adopt another family',
    409,
    'SESSION_CHANGED'
  )
}
