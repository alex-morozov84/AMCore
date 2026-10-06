import { createInvitationOperationId, InviteErrorCode } from '@amcore/shared'

import {
  INVITATION_RETENTION_MS,
  invitationFingerprint,
  replayInvitationOperation,
} from './invitation-operation'

import type { InvitationOperation, Prisma } from '@/generated/prisma/client'

const now = new Date('2026-10-04T12:00:00.000Z')
const intent = { kind: 'accept', expectedInviteId: 'invitation-a', expectedGeneration: 1 }
const fingerprint = invitationFingerprint(intent)
const result = { status: 'accepted', organizationId: 'organization-a', memberId: 'membership-a' }
const tx = {
  $queryRaw: jest.fn(async () => [{ value: now }]),
} as unknown as Prisma.TransactionClient
const receipt = (changes: Partial<InvitationOperation> = {}): InvitationOperation => ({
  id: 'receipt',
  actorId: 'actor',
  organizationId: null,
  scope: 'personal',
  operationId: createInvitationOperationId(now.getTime()),
  kind: 'accept',
  fingerprint,
  intent,
  result,
  completedAt: now,
  ...changes,
})

describe('durable invitation operation decisions', () => {
  it('replays a matching receipt even after its original first-execution window', async () => {
    const oldId = createInvitationOperationId(now.getTime() - 2 * 86400000)
    expect(
      await replayInvitationOperation(tx, receipt({ operationId: oldId }), oldId, fingerprint)
    ).toEqual(result)
  })

  it('conflicts on another target even when the operation ID is identical', async () => {
    const other = invitationFingerprint({ ...intent, expectedInviteId: 'invitation-b' })
    await expect(
      replayInvitationOperation(tx, receipt(), receipt().operationId, other)
    ).rejects.toMatchObject({
      errorCode: InviteErrorCode.INVITE_OPERATION_CONFLICT,
    })
  })

  it('never executes a pruned/aged first request or a future-skewed ID', async () => {
    for (const timestamp of [now.getTime() - 86400001, now.getTime() + 300001]) {
      await expect(
        replayInvitationOperation(tx, null, createInvitationOperationId(timestamp), fingerprint)
      ).rejects.toMatchObject({
        errorCode: InviteErrorCode.INVITE_OPERATION_EXPIRED,
      })
    }
  })

  it('treats an expired receipt as unavailable before physical pruning', async () => {
    const row = receipt({ completedAt: new Date(now.getTime() - INVITATION_RETENTION_MS) })
    await expect(
      replayInvitationOperation(tx, row, row.operationId, fingerprint)
    ).rejects.toMatchObject({
      errorCode: InviteErrorCode.INVITE_OPERATION_EXPIRED,
    })
  })
})
