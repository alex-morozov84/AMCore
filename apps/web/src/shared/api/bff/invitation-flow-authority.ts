import { randomBytes } from 'node:crypto'

import {
  AuthErrorCode,
  type InvitationAdmission,
  type InvitationFlowBinding,
  InviteErrorCode,
} from '@amcore/shared'

import { ContextRequestError } from './context-errors'
import { INVITATION_OWNER_TTL_SECONDS } from './invitation-cookie'
import type { InvitationOwnerRecord, InvitationVaultFlow } from './invitation-vault-record'

import 'server-only'

export function newInvitationOwner(
  origin: string,
  sessionBinding: string | null,
  now: number
): InvitationOwnerRecord {
  return {
    version: 1,
    origin,
    expiresAt: now + INVITATION_OWNER_TTL_SECONDS * 1000,
    epoch: 0,
    sessionBinding,
    admissionsStartedAt: now,
    admissions: 0,
    flows: [],
    pendingOAuthAttemptId: null,
  }
}

export function invitationFlowChanged(): ContextRequestError {
  return new ContextRequestError(409, InviteErrorCode.INVITE_FLOW_CHANGED)
}

/** Reads never rebind; an owner proof alone cannot select a previous account's summary. */
export function currentInvitationFlow(
  owner: InvitationOwnerRecord,
  id: string,
  sessionBinding: string | null,
  now: number
): InvitationVaultFlow {
  const flow = owner.flows.find((candidate) => candidate.binding.flowId === id)
  if (owner.expiresAt <= now || !flow || flow.expiresAt <= now)
    throw new ContextRequestError(400, InviteErrorCode.INVITE_INVALID_OR_EXPIRED)
  if (
    flow.state === 'retired' ||
    (flow.state === 'authenticating' && flow.attempt !== null && flow.attempt.expiresAt <= now) ||
    owner.sessionBinding !== sessionBinding ||
    flow.binding.sessionBinding !== sessionBinding
  )
    throw invitationFlowChanged()
  return flow
}

export function expectedInvitationFlow(
  owner: InvitationOwnerRecord,
  binding: InvitationFlowBinding,
  incomingSession: string | null,
  now: number
): InvitationVaultFlow {
  const flow = currentInvitationFlow(owner, binding.flowId, incomingSession, now)
  if (
    flow.binding.flowRevision !== binding.flowRevision ||
    flow.binding.sessionBinding !== binding.sessionBinding
  )
    throw invitationFlowChanged()
  return flow
}

export function admitInvitationFlow(
  owner: InvitationOwnerRecord,
  admission: InvitationAdmission,
  locale: string,
  incomingSession: string | null,
  now: number
): { owner: InvitationOwnerRecord; flow: InvitationVaultFlow } {
  if (owner.sessionBinding !== incomingSession || owner.expiresAt <= now)
    throw invitationFlowChanged()
  const flows = owner.flows.filter(
    (flow) =>
      flow.expiresAt > now &&
      flow.state !== 'retired' &&
      !(flow.state === 'authenticating' && flow.attempt && flow.attempt.expiresAt <= now)
  )
  const admissions = owner.admissionsStartedAt + 3600000 <= now ? 0 : owner.admissions
  if (flows.length >= 5 || admissions >= 20)
    throw new ContextRequestError(429, AuthErrorCode.RATE_LIMIT_EXCEEDED)
  const expiresAt = Math.min(Date.parse(admission.expiresAt), now + 1800000, owner.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now)
    throw new ContextRequestError(400, InviteErrorCode.INVITE_INVALID_OR_EXPIRED)
  const flow: InvitationVaultFlow = {
    binding: {
      flowId: randomBytes(16).toString('base64url'),
      flowRevision: 1,
      sessionBinding: incomingSession,
    },
    intent: admission.intent,
    credential: admission.credential,
    expiresAt,
    locale,
    state: 'active',
    attempt: null,
    handoff: null,
  }
  return {
    flow,
    owner: {
      ...owner,
      flows: [...flows, flow],
      pendingOAuthAttemptId: flows.some(
        (candidate) => candidate.attempt?.id === owner.pendingOAuthAttemptId
      )
        ? owner.pendingOAuthAttemptId
        : null,
      admissions: admissions + 1,
      admissionsStartedAt: admissions === 0 ? now : owner.admissionsStartedAt,
    },
  }
}

/** Ordinary account publication invalidates every old projection without rotating the owner cookie. */
export function retireInvitationFlows(
  owner: InvitationOwnerRecord,
  sessionBinding: string | null
): InvitationOwnerRecord {
  return {
    ...owner,
    sessionBinding,
    epoch: owner.epoch + 1,
    pendingOAuthAttemptId: null,
    flows: owner.flows.map((flow) => ({
      ...flow,
      state: 'retired',
      binding: { ...flow.binding, flowRevision: flow.binding.flowRevision + 1 },
    })),
  }
}
