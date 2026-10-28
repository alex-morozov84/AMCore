import { randomUUID } from 'node:crypto'

import type { Request } from 'express'

import {
  type LoginPublication,
  type RegistrationPublicationIntent,
  registrationPublicationIntentSchema,
} from '@amcore/shared'

import { AppException } from '../../../common/exceptions/index.js'
import type { Prisma, User } from '../../../generated/prisma/client.js'
import { browserSessionContext } from '../../frontend-context/browser-session-context.service.js'
import type { TokenService } from '../token.service.js'

import type { BrowserRequestBinding } from './browser-binding.js'
import {
  lockBrowserLoginBinding,
  type LockedBrowserLogin,
  reserveBrowserLogin,
} from './browser-login-reservation.js'
import { type IssuedFamilyCredentials, writeFamily } from './mfa-family-writer.js'
import { continuationHash } from './mfa-flow-lock.js'
import type { StoredInvitationIntent } from './mfa-invitation-intent.js'
import { publicationSecretHash } from './mfa-publication-record.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

export interface RegistrationBrowserIntent extends RegistrationPublicationIntent {
  browser: BrowserRequestBinding
}

/** Actual private transport is mandatory; proposal fields alone carry no identity authority. */
export function registrationBrowserIntent(request: Request): RegistrationBrowserIntent | undefined {
  const transport = browserSessionContext(request)
  const fields = {
    continuation: request.headers['x-mfa-continuation'],
    vaultBinding: request.headers['x-mfa-vault-binding'],
    operationId: request.headers['x-amcore-login-attempt'],
  }
  if (!transport && Object.values(fields).every((value) => value === undefined)) return undefined
  const parsed = registrationPublicationIntentSchema.safeParse(fields)
  if (
    !transport?.binding ||
    !parsed.success ||
    request.headers.authorization ||
    request.headers['x-api-key']
  )
    throw changed()
  return { ...parsed.data, browser: transport.binding }
}

export async function lockRegistrationBrowser(
  tx: Prisma.TransactionClient,
  intent: RegistrationBrowserIntent | undefined,
  userId: string
): Promise<LockedBrowserLogin | undefined> {
  if (!intent) return undefined
  const locked = await lockBrowserLoginBinding(tx, intent.browser, userId)
  if (!locked) throw changed()
  return locked
}

/** Joins the existing user/session/email-token transaction; performs no Redis or external work. */
export async function writeRegistrationPublication(
  tx: Prisma.TransactionClient,
  tokens: TokenService,
  input: {
    user: User
    intent: RegistrationBrowserIntent
    locked: LockedBrowserLogin
    invitation?: StoredInvitationIntent
    userAgent?: string
    ipAddress?: string
  }
): Promise<
  Omit<IssuedFamilyCredentials, 'publication'> & {
    sessionId: string
    publication: LoginPublication
  }
> {
  const { user, intent, invitation } = input
  const now = await mfaDatabaseClock(tx),
    flowId = randomUUID(),
    proofId = randomUUID()
  const expiresAt = new Date(
    Math.min(now.getTime() + 300000, invitation ? Date.parse(invitation.expiresAt) : Infinity)
  )
  const context = await reserveBrowserLogin(tx, input.locked, intent.browser, flowId, expiresAt)
  if (!context || expiresAt <= now) throw changed()
  await tx.mfaAccount.create({ data: { userId: user.id } })
  const flow = await tx.mfaFlow.create({
    data: {
      id: flowId,
      userId: user.id,
      credentialHash: continuationHash(intent.continuation)!,
      purpose: 'login',
      authorityKind: 'identity',
      audience: intent.browser.audience,
      bindingHash: intent.browser.bindingHash,
      securityVersion: 0,
      browserContextId: context.id,
      publicationGeneration: context.generation,
      expiresAt,
      primaryAt: now,
      data: {
        ...(invitation ? { invitation } : {}),
        proofs: {
          primary: {
            method: 'password',
            eventId: proofId,
            verifiedAt: now.toISOString(),
            origin: { kind: 'flow', flowId },
          },
          secondFactor: null,
        },
      },
    },
  })
  const deadline = new Date(Math.min(now.getTime() + 60000, expiresAt.getTime()))
  const issued = await writeFamily(
    tx,
    {
      flow,
      context,
      user,
      invitation,
      securityVersion: 0,
      primaryMethod: 'password',
      primaryAt: now,
      primaryProofId: proofId,
      mfa: null,
      recoveryGeneration: null,
      vaultHash: publicationSecretHash('vault', intent.vaultBinding),
      audience: intent.browser.audience,
      expiresAt: tokens.getRefreshTokenExpiration(),
      deadline,
      operationId: intent.operationId,
      replaceOperation: false,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    },
    tokens
  )
  if (deadline <= (await mfaDatabaseClock(tx))) throw changed()
  return {
    ...issued,
    sessionId: issued.publication.sessionId,
    publication: {
      continuation: intent.continuation,
      operationId: intent.operationId,
      receipt: issued.receipt,
      familyId: issued.publication.familyId,
      securityVersion: 0,
      browser: {
        contextId: context.id,
        generation: context.generation,
        audience: intent.browser.audience,
      },
    },
  }
}
function changed(): AppException {
  return new AppException('Registration browser context changed', 409, 'AUTH_CONTEXT_CHANGED')
}
