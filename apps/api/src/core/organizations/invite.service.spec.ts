import { createHash } from 'node:crypto'

import { mockDeep } from 'jest-mock-extended'

import { createInvitationOperationId, InviteErrorCode, SystemRole } from '@amcore/shared'

import { ForbiddenException } from '../../common/exceptions'
import { EmailIdentityService } from '../auth/email-identity.service'

import { invitationActor } from './invitation-actor'
import { InvitationCommandService } from './invitation-command.service'
import { invitationFingerprint } from './invitation-operation'

import type { PrismaClient } from '@/generated/prisma/client'

const now = new Date()
const principal = {
  type: 'jwt' as const,
  sub: 'manager',
  systemRole: SystemRole.User,
  organizationId: 'organization',
}
const actor = invitationActor({
  user: principal,
  privilegedAdmission: { authenticated: principal, principal },
})
const role = {
  id: 'member-role',
  name: 'MEMBER',
  description: null,
  isSystem: true,
  organizationId: null,
}

function setup() {
  const prisma = mockDeep<PrismaClient>()
  prisma.$transaction.mockImplementation((async (work: (tx: typeof prisma) => unknown) =>
    work(prisma)) as never)
  prisma.$queryRaw.mockImplementation((async (
    query: TemplateStringsArray | { strings: string[] }
  ) => {
    const sql = ('strings' in query ? query.strings : query).join('')
    if (sql.includes('core.roles')) return [role]
    if (sql.includes('core.org_invites'))
      return [{ id: 'invitation', generation: 1, expiresAt: new Date(now.getTime() + 60000) }]
    return [{ value: now }]
  }) as never)
  prisma.organization.findUniqueOrThrow.mockResolvedValue({ name: 'Issued organization' } as never)
  prisma.user.findUniqueOrThrow.mockResolvedValue({ name: 'Issued inviter', email: 'manager@example.test' } as never)
  prisma.role.findMany.mockResolvedValue([role] as never)
  prisma.user.findUnique.mockResolvedValue(null)
  prisma.orgMember.findUnique.mockResolvedValue(null)
  prisma.orgInvite.findFirst.mockResolvedValue(null)
  prisma.orgInvite.create.mockResolvedValue({ id: 'invitation' } as never)
  prisma.invitationOperation.findUnique.mockResolvedValue(null)
  const authorization = {
    lockActor: jest.fn(async () => ({ id: principal.sub })),
    authorize: jest.fn(async () => undefined),
  }
  const audit = { record: jest.fn(async () => undefined) }
  const mail = { dispatch: jest.fn(async (_mail: unknown): Promise<void> => undefined), reportOutcome: jest.fn() }
  const limiter = { consume: jest.fn(async () => undefined) }
  const service = new InvitationCommandService(
    prisma as never,
    authorization as never,
    new EmailIdentityService(),
    limiter as never,
    audit as never,
    mail as never
  )
  return { service, prisma, authorization, audit, mail, limiter }
}
const command = { kind: 'create' as const, dto: { email: 'dana@example.com' } }
const operation = () => createInvitationOperationId(now.getTime())

describe('invitation issuance decisions', () => {
  it('rejects foreign organization context before any database or mail work', async () => {
    const { service, prisma, mail } = setup()
    await expect(
      service.execute('foreign-org', command, actor, operation())
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(mail.dispatch).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'acknowledges known=%s nonmembers uniformly and captures truthful email intent',
    async (known) => {
      const { service, prisma, mail, audit } = setup()
      if (known) prisma.user.findUnique.mockResolvedValue({ id: 'dana', locale: 'ru' } as never)
      expect(await service.execute('organization', command, actor, operation())).toEqual({
        status: 'invited',
      })
      expect(mail.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'dana@example.com',
          roleNames: ['MEMBER'],
          hasAccount: known,
          locale: known ? 'ru' : null,
        })
      )
      expect(prisma.orgInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            roleIntents: {
              create: [
                {
                  ordinal: 0,
                  requestedRoleId: role.id,
                  liveRoleId: role.id,
                  roleNameAtIssue: role.name,
                },
              ],
            },
          }),
        })
      )
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            emailHash: createHash('sha256').update(command.dto.email).digest('hex'),
            roleIds: [role.id],
          }),
        }),
        expect.anything()
      )
    }
  )

  it('preserves existing membership roles with no invitation or email but durable acknowledgment', async () => {
    const { service, prisma, mail } = setup()
    prisma.user.findUnique.mockResolvedValue({ id: 'dana', locale: 'en' } as never)
    prisma.orgMember.findUnique.mockResolvedValue({ id: 'existing' } as never)
    expect(await service.execute('organization', command, actor, operation())).toEqual({
      status: 'invited',
    })
    expect(prisma.orgInvite.create).not.toHaveBeenCalled()
    expect(prisma.memberRole.createMany).not.toHaveBeenCalled()
    expect(mail.dispatch).not.toHaveBeenCalled()
    expect(prisma.invitationOperation.create).toHaveBeenCalled()
  })

  it('requires an explicit reissue rather than rotating a retained existing invitation', async () => {
    const { service, prisma, mail } = setup()
    prisma.orgInvite.findFirst.mockResolvedValue({ id: 'invitation' } as never)
    await expect(
      service.execute('organization', command, actor, operation())
    ).rejects.toMatchObject({ errorCode: InviteErrorCode.INVITE_ALREADY_PENDING })
    expect(prisma.orgInvite.update).not.toHaveBeenCalled()
    expect(mail.dispatch).not.toHaveBeenCalled()
  })

  it('rejects ambiguous default roles instead of selecting arbitrary metadata', async () => {
    const { service, prisma } = setup()
    prisma.role.findMany.mockResolvedValue([role, { ...role, id: 'duplicate' }] as never)
    await expect(
      service.execute('organization', command, actor, operation())
    ).rejects.toMatchObject({ errorCode: InviteErrorCode.INVITE_ROLE_INTENT_INVALID })
    expect(prisma.orgInvite.create).not.toHaveBeenCalled()
  })

  it('replays omitted-default intent before resolving a changed default, without mail or audit repetition', async () => {
    const { service, prisma, mail, audit, limiter } = setup()
    prisma.invitationOperation.findUnique.mockResolvedValue({
      completedAt: now,
      result: { status: 'invited' },
      fingerprint: invitationFingerprint({
        kind: 'create',
        email: command.dto.email,
        roleSelection: { kind: 'default-member' },
      }),
    } as never)
    prisma.role.findMany.mockResolvedValue([])
    expect(await service.execute('organization', command, actor, operation())).toEqual({
      status: 'invited',
    })
    expect(limiter.consume).not.toHaveBeenCalled()
    expect(prisma.role.findMany).not.toHaveBeenCalled()
    expect(prisma.orgInvite.create).not.toHaveBeenCalled()
    expect(mail.dispatch).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('rechecks manager authority even for a matching receipt', async () => {
    const { service, prisma, authorization, mail } = setup()
    prisma.invitationOperation.findUnique.mockResolvedValue({
      completedAt: now,
      fingerprint: 'existing',
    } as never)
    authorization.authorize.mockRejectedValue(new ForbiddenException())
    await expect(
      service.execute('organization', command, actor, operation())
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(mail.dispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch mail when the transactional audit fails', async () => {
    const { service, audit, mail } = setup()
    audit.record.mockRejectedValue(new Error('audit unavailable'))
    await expect(
      service.execute('organization', command, actor, operation())
    ).rejects.toMatchObject({ errorCode: 'SERVICE_UNAVAILABLE' })
    expect(mail.dispatch).not.toHaveBeenCalled()
  })
})


describe('actual issuance acknowledgment and snapshot', () => {
  afterEach(() => jest.useRealTimers())
  it.each(['create', 'reissue'] as const)('bounds stalled %s mail and never resends a committed key', async kind => {
    jest.useFakeTimers({ now })
    const { service, prisma, mail, audit, limiter } = setup()
    const id = operation()
    let finish!: () => void
    mail.dispatch.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const cmd = kind === 'create' ? command : { kind, id: 'invitation', dto: { mode: 'replace' as const, roleIds: [role.id], expectedGeneration: 1 } }
    if (kind === 'reissue') {
      prisma.orgInvite.findFirst.mockResolvedValue({ generation: 1, acceptedAt: null, revokedAt: null } as never)
      prisma.$queryRaw.mockImplementation((async (query: TemplateStringsArray | { strings: string[] }) => {
        const sql = ('strings' in query ? query.strings : query).join('')
        if (sql.includes('core.roles')) return [role]
        if (sql.includes('core.org_invites')) return [{ id: 'invitation', generation: 1, email: command.dto.email, emailCanonical: command.dto.email, expiresAt: new Date(now.getTime()+60000) }]
        return [{ value: now }]
      }) as never)
    }
    const pending = service.execute('organization', cmd, actor, id)
    await jest.advanceTimersByTimeAsync(249)
    expect(mail.dispatch).toHaveBeenCalledTimes(1)
    expect(prisma.invitationOperation.create).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual({ status: 'invited' })
    expect(mail.reportOutcome).toHaveBeenCalledWith('organization', 'timeout')
    const receipt = prisma.invitationOperation.create.mock.calls[0]![0].data
    prisma.invitationOperation.findUnique.mockResolvedValue({ ...receipt, completedAt: now } as never)
    limiter.consume.mockRejectedValue(new Error('exhausted should not be checked on replay'))
    prisma.organization.findUniqueOrThrow.mockRejectedValue(new Error('deleted after commit'))
    prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('deleted after commit'))
    finish()
    await expect(service.execute('organization', cmd, actor, id)).resolves.toEqual({ status: 'invited' })
    expect(mail.dispatch).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(limiter.consume).toHaveBeenCalledTimes(1)
    expect(mail.dispatch.mock.calls[0]).toEqual([expect.objectContaining({ orgName: 'Issued organization', inviterName: 'Issued inviter', inviterEmail: 'manager@example.test', roleNames: ['MEMBER'] })])
  })
  it('acknowledges a rejected provider without rolling back or leaking its exception', async () => {
    const { service, mail, prisma } = setup()
    mail.dispatch.mockRejectedValue(new Error('fake-private-provider-body'))
    await expect(service.execute('organization', command, actor, operation())).resolves.toEqual({ status: 'invited' })
    expect(prisma.invitationOperation.create).toHaveBeenCalledTimes(1)
    expect(mail.reportOutcome).toHaveBeenCalledWith('organization', 'failed')
    expect(JSON.stringify(mail.reportOutcome.mock.calls)).not.toContain('fake-private')
  })
})
