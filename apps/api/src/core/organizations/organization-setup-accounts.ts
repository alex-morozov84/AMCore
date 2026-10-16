import {
  DEFAULT_LOCALE,
  type OrganizationPrepareAccount,
  type OrganizationPreparedAccount,
} from '@amcore/shared'

import type { Prisma } from '../../generated/prisma/client.js'
import { EmailIdentityService } from '../auth/email-identity.service.js'

import { admitSetupOperator, type SetupOperator } from './organization-setup-admission.js'

/** Preparation never changes credentials, locale, verification or roles on an existing identity. */
export async function prepareSetupAccount(
  tx: Prisma.TransactionClient,
  input: OrganizationPrepareAccount,
  operator?: SetupOperator
): Promise<OrganizationPreparedAccount> {
  const identity = new EmailIdentityService()
  const email = identity.normalizeForStorage(input.email)
  const emailCanonical = identity.canonicalize(email)
  const existing = await tx.user.findUnique({
    where: { emailCanonical },
    select: { id: true, emailVerified: true },
  })
  await admitSetupOperator(tx, operator, true)
  const user =
    existing ??
    (await tx.user.create({
      data: {
        email,
        emailCanonical,
        locale: input.locale ?? DEFAULT_LOCALE,
        passwordHash: null,
        emailVerified: false,
        systemRole: 'USER',
      },
      select: { id: true, emailVerified: true },
    }))
  if (!existing)
    await tx.auditLog.create({
      data: {
        action: 'org.setup_account_prepared',
        actorType: operator ? 'USER' : 'SYSTEM',
        actorId: operator?.principal.sub ?? null,
        targetType: 'USER',
        targetId: user.id,
        metadata: { userId: user.id, source: operator ? 'bootstrap-console' : 'bootstrap-cli' },
      },
    })
  return {
    status: existing ? 'existing' : 'created',
    userId: user.id,
    emailVerified: user.emailVerified,
    nextAction: user.emailVerified ? 'sign-in' : 'verify-email',
  }
}
