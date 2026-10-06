import { inspect } from 'node:util'

import { createInvitationOperationId } from '@amcore/shared'

import { AuditLogService } from '../../src/core/audit'
import { InviteAcceptService } from '../../src/core/organizations/invite-accept.service'
import { InviteAcceptLimiterService } from '../../src/core/organizations/invite-accept-limiter.service'
import { OrganizationsService } from '../../src/core/organizations/organizations.service'
import { EmailService } from '../../src/infrastructure/email/email.service'
import { boundedFailure } from '../helpers/invitation-operation'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
import { invitationFence } from '../helpers/invitation-race'
const jest = import.meta.jest

export function registerDurabilityProofs(getFixture: () => InvitationProofFixture): void {
  it('R15 lost commit acknowledgment is503 with exactly one persisted grant', async () => {
    const { prisma, pending, accept, outcome, truth } = getFixture()
    const { token, invite } = await pending()
    const method = prisma.$transaction
    const original = (jest.isMockFunction(method) ? method.getMockImplementation()! : method).bind(
      prisma
    )
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
      ...args: unknown[]
    ) => {
      await (original as (...a: unknown[]) => Promise<unknown>)(...args)
      throw new Error('simulated lost commit acknowledgment')
    }) as never)
    try {
      expect(await outcome(accept(token))).toBe(503)
      expect((await truth(invite.id)).audit).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
    expect(await outcome(accept(token))).toBe(400)
  })

  it('R14 revoke audit failure and create audit failure leave no committed effect or email', async () => {
    const { context, prisma, invites, orgId, actor, pending, outcome } = getFixture()
    const { invite } = await pending()
    const original = await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })
    const audit = jest
      .spyOn(context.app.get(AuditLogService), 'record')
      .mockRejectedValue(new Error('audit unavailable'))
    const mail = jest
      .spyOn(context.app.get(EmailService), 'sendOrgInviteEmail')
      .mockResolvedValue(undefined)
    try {
      expect(
        await outcome(
          invites.revokeInvite(orgId, invite.id, 1, actor(), createInvitationOperationId())
        )
      ).toBe(503)
      expect(await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).toEqual(
        original
      )
      expect(
        await outcome(
          invites.createInvite(
            orgId,
            { email: 'new@example.test' },
            actor(),
            createInvitationOperationId()
          )
        )
      ).toBe(503)
      expect(await prisma.orgInvite.count({ where: { emailCanonical: 'new@example.test' } })).toBe(
        0
      )
      expect(mail).not.toHaveBeenCalled()
    } finally {
      audit.mockRestore()
      mail.mockRestore()
    }
  })

  it.each(['P2034', 'P2024', 'P2028'] as const)(
    'R15/R16 %s infrastructure is not a token decision',
    async (code) => {
      const { context, prisma, pending, accept, outcome, truth } = getFixture()
      const { token, invite } = await pending()
      const before = await truth(invite.id)
      const transaction = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce({ code })
      const consume = jest.spyOn(context.app.get(InviteAcceptLimiterService), 'consume')
      try {
        expect(await outcome(accept(token))).toBe(code === 'P2034' ? 409 : 503)
        expect(consume).not.toHaveBeenCalled()
        expect(await truth(invite.id)).toEqual(before)
      } finally {
        transaction.mockRestore()
        consume.mockRestore()
      }
    }
  )

  it('R14 failure immediately after membership creation leaves no orphan or claim', async () => {
    const { context, prisma, pending, accept, outcome, truth } = getFixture()
    const { token, invite } = await pending()
    const before = await truth(invite.id)
    const fault = invitationFence(prisma, (model, method) => {
      if (model === 'orgMember' && method === 'create') throw new Error('injected after membership')
      return false
    })
    const consume = jest.spyOn(context.app.get(InviteAcceptLimiterService), 'consume')
    try {
      expect(await outcome(accept(token))).toBe(503)
      expect(await truth(invite.id)).toEqual(before)
      expect(consume).not.toHaveBeenCalled()
    } finally {
      fault.restore()
      consume.mockRestore()
    }
  })

  it('R14 audit failure rolls back claim, member, role link and ACL', async () => {
    const { context, pending, accept, outcome, truth } = getFixture()
    const { token, invite } = await pending()
    const before = await truth(invite.id)
    const spy = jest
      .spyOn(context.app.get(AuditLogService), 'record')
      .mockRejectedValueOnce(new Error('injected audit failure'))
    try {
      expect(await outcome(accept(token))).toBe(503)
      expect(await truth(invite.id)).toEqual(before)
    } finally {
      spy.mockRestore()
    }
  })

  it('F1/R15 stalled reset returns acknowledged success and safely absorbs late rejection', async () => {
    const { context, prisma, pending, accept, outcome, truth } = getFixture()
    const { token, invite } = await pending()
    const before = await truth(invite.id)
    let reject!: (reason: unknown) => void
    const stalled = new Promise<void>((_, no) => {
      reject = no
    })
    const reset = jest
      .spyOn(context.app.get(InviteAcceptLimiterService), 'reset')
      .mockReturnValueOnce(stalled)
    const service = context.app.get(InviteAcceptService)
    const logger = (service as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger
    const warning = jest.spyOn(logger, 'warn')
    const transaction = jest.spyOn(prisma, '$transaction')
    transaction.mockClear()
    const unhandled: unknown[] = []
    const record = (error: unknown): void => {
      unhandled.push(error)
    }
    process.on('unhandledRejection', record)
    try {
      expect(
        await Promise.race([outcome(accept(token)), boundedFailure('Acknowledged response')])
      ).toBe(200)
      expect(reset).toHaveBeenCalledTimes(1)
      expect(transaction).toHaveBeenCalledTimes(1)
      const after = await truth(invite.id)
      expect(after.members).toHaveLength(1)
      expect(after.members[0]!.roles.map((r) => r.roleId)).toEqual([
        invite.roleIntents[0]?.liveRoleId,
      ])
      expect(after.org!.aclVersion).toBe(before.org!.aclVersion + 1)
      expect(after.audit).toHaveLength(1)
      expect(warning).toHaveBeenCalledWith(
        {
          event: 'org.invite.post_commit_failed',
          category: 'accept_limiter_reset',
          reason: 'timeout',
        },
        'Invite committed; post-commit operation failed'
      )
      reject(new Error(token, { cause: new Error(token) }))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
      expect(inspect(warning.mock.calls, { depth: 10 })).not.toContain(token)
      expect(await truth(invite.id)).toEqual(after)
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(await outcome(accept(token))).toBe(400)
      expect(await truth(invite.id)).toEqual(after)
    } finally {
      reject(new Error('safe teardown'))
      process.off('unhandledRejection', record)
      reset.mockRestore()
      warning.mockRestore()
      transaction.mockRestore()
    }
  })

  it('R15 acknowledged commit survives cache invalidation/reset failure', async () => {
    const { context, pending, accept, outcome, truth } = getFixture()
    const { token, invite } = await pending()
    const cache = jest
      .spyOn(context.app.get(OrganizationsService), 'invalidateAclVersion')
      .mockRejectedValueOnce(new Error('cache unavailable'))
    const limiter = jest
      .spyOn(context.app.get(InviteAcceptLimiterService), 'reset')
      .mockRejectedValueOnce(new Error('redis unavailable'))
    try {
      expect(await outcome(accept(token))).toBe(200)
      expect((await truth(invite.id)).audit).toHaveLength(1)
      expect(await outcome(accept(token))).toBe(400)
    } finally {
      cache.mockRestore()
      limiter.mockRestore()
    }
  })
}
