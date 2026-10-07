import { createInvitationOperationId, InviteErrorCode, SystemRole } from '@amcore/shared'

import { invitationFingerprint } from './invitation-operation'
import { InviteAcceptService } from './invite-accept.service'

const now = new Date()
const descriptor = { expectedInviteId: 'invitation-a', expectedGeneration: 1 }
const intent = { kind: 'accept', ...descriptor }
const result = { status: 'accepted', organizationId: 'organization-a', memberId: 'membership-a' }
const actor = {
  type: 'jwt' as const,
  sub: 'actor-a',
  sid: 'session-a',
  systemRole: SystemRole.User,
}
const operation = createInvitationOperationId(now.getTime())

function setup() {
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async (query: TemplateStringsArray) =>
      query.join('').includes('core.users')
        ? [{ id: actor.sub, emailCanonical: 'member@example.com', emailVerified: true }]
        : [{ value: now }]
    ),
    invitationOperation: {
      findUnique: jest.fn(async () => ({
        intent,
        result,
        completedAt: now,
        fingerprint: invitationFingerprint(intent),
      })),
    },
    orgInvite: { findUnique: jest.fn() },
    orgMember: { findUnique: jest.fn(async () => null) },
  }
  const prisma = { $transaction: jest.fn(async (work: (value: typeof tx) => unknown) => work(tx)) }
  const live = { assert: jest.fn(async () => undefined) }
  const service = new InviteAcceptService(
    prisma as never,
    { invalidateAclVersion: jest.fn(async () => undefined) } as never,
    {} as never,
    {
      check: jest.fn(async () => undefined),
      reset: jest.fn(async () => undefined),
      consume: jest.fn(async () => undefined),
    } as never,
    { setContext: jest.fn(), warn: jest.fn() } as never,
    live as never
  )
  return { service, tx, live }
}

describe('acceptance stable intent recovery', () => {
  it('returns original acceptance with an expired/consumed credential without reading it', async () => {
    const { service, tx } = setup()
    expect(
      await service.accept({ token: 'expired-credential' }, descriptor, operation, actor, 'ip')
    ).toEqual(result)
    expect(tx.orgInvite.findUnique).not.toHaveBeenCalled()
  })

  it('rejects same-ID target replacement before credential lookup', async () => {
    const { service, tx } = setup()
    await expect(
      service.accept(
        { token: 'invalid-credential' },
        { ...descriptor, expectedInviteId: 'invitation-b' },
        operation,
        actor,
        'ip'
      )
    ).rejects.toMatchObject({ errorCode: InviteErrorCode.INVITE_OPERATION_CONFLICT })
    expect(tx.orgInvite.findUnique).not.toHaveBeenCalled()
  })

  it('recovers own proof with removed access without a continuation and never regrants', async () => {
    const { service, tx } = setup()
    expect(await service.operation(operation, actor)).toEqual({
      state: 'committed',
      intent: descriptor,
      result,
      access: 'removed',
    })
    expect(tx.orgInvite.findUnique).not.toHaveBeenCalled()
  })
})
