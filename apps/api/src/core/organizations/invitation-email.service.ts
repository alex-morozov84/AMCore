import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { coerceSupportedLocale, localizedFrontendUrl, productAdminPath } from '@amcore/shared'

import { EnvService } from '../../env/env.service.js'
import { EmailService } from '../../infrastructure/email/index.js'
import {
  type BrowserFrontendContext,
  resolveFrontendPlacement,
} from '../frontend-context/frontend-placement.js'

/** Ephemeral issuance-time display snapshot; never persisted or queued with its secret. */
export type InvitationMailSnapshot = {
  email: string
  token: string
  roleNames: string[]
  locale: string | null
  hasAccount: boolean
  orgName: string
  inviterName: string
  inviterEmail: string
}

@Injectable()
export class InvitationEmailService {
  constructor(
    private readonly email: EmailService,
    private readonly env: EnvService,
    private readonly logger: PinoLogger
  ) {}

  destination(): BrowserFrontendContext {
    return {
      frontend: 'admin' as const,
      placementFingerprint: resolveFrontendPlacement(this.env).placementFingerprint,
    }
  }

  async dispatch(mail: InvitationMailSnapshot): Promise<void> {
    const locale = coerceSupportedLocale(mail.locale)
    await this.email.sendOrgInviteEmail(mail.email, {
      orgName: mail.orgName,
      inviterName: mail.inviterName,
      inviterEmail: mail.inviterEmail,
      roleName: mail.roleNames.join(', '),
      hasAccount: mail.hasAccount,
      expiresInDays: 7,
      locale,
      acceptUrl: localizedFrontendUrl(
        resolveFrontendPlacement(this.env).admin,
        locale,
        productAdminPath('/invite/accept'),
        {
          token: mail.token,
        }
      ),
    })
  }

  reportOutcome(orgId: string, category: 'failed' | 'timeout'): void {
    this.logger.warn(
      { event: 'org.invite.email_dispatch_failed', orgId, category },
      'Invitation committed; email dispatch was not acknowledged within the optional wait'
    )
  }
}
