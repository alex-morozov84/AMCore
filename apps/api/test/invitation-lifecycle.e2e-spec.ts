import { createHash, randomBytes } from 'node:crypto'

import { Pool } from 'pg'

import { type RequestPrincipal, SystemRole } from '@amcore/shared'

import { invitationActor } from '../src/core/organizations/invitation-actor'
import { InviteService } from '../src/core/organizations/invite.service'
import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedOrgMember,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'
import {
  carryInvitationBackend,
  observeInvitationTransactions,
  trackInvitationOperation,
} from './helpers/invitation-operation'
import { invitationFence, observeInvitationWait } from './helpers/invitation-race'
import { registerAdmittedAuthorityProofs } from './invitation-lifecycle/admitted-authority'
import { registerAuthorityProofs } from './invitation-lifecycle/authority'
import { registerBudgetsProofs } from './invitation-lifecycle/budgets'
import { registerCleanupProofs } from './invitation-lifecycle/cleanup'
import { registerDurabilityProofs } from './invitation-lifecycle/durability'
import { registerExpiryProofs } from './invitation-lifecycle/expiry'
import { registerFenceProofs } from './invitation-lifecycle/fences'
import { registerForeignKeysProofs } from './invitation-lifecycle/foreignKeys'
import { registerIdentityProofs } from './invitation-lifecycle/identity'
import { registerTransitionsProofs } from './invitation-lifecycle/transitions'

describe('Invitation lifecycle transaction proofs', () => {
  let context: E2ETestContext
  let prisma: PrismaService
  let pool: Pool
  let invites: InviteService
  let orgId: string
  let owner: RequestPrincipal
  let recipient: RequestPrincipal
  let roleId: string
  beforeAll(async () => {
    context = await setupE2ETest()
    prisma = context.prisma
    pool = new Pool({
      connectionString: context.postgresContainer.getConnectionUri(),
      statement_timeout: 3000,
      connectionTimeoutMillis: 1500,
    })
    invites = context.app.get(InviteService)
    await seedSystemRoles(prisma)
  }, 120000)
  afterAll(async () => {
    await pool?.end()
    if (context) await teardownE2ETest(context)
  }, 120000)
  let restoreTracking: () => void
  afterEach(() => restoreTracking?.())
  beforeEach(async () => {
    restoreTracking = observeInvitationTransactions(prisma)
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    const org = await prisma.organization.create({
      data: { name: 'Lifecycle proof', slug: 'lifecycle-proof' },
    })
    orgId = org.id
    const users = await Promise.all(
      ['owner', 'recipient'].map((name) =>
        prisma.user.create({
          data: {
            email: `${name}@example.test`,
            emailCanonical: `${name}@example.test`,
            emailVerified: true,
          },
        })
      )
    )
    owner = {
      type: 'jwt',
      sub: users[0]!.id,
      email: users[0]!.email,
      systemRole: SystemRole.User,
      organizationId: orgId,
    }
    recipient = {
      type: 'jwt',
      sub: users[1]!.id,
      email: users[1]!.email,
      systemRole: SystemRole.User,
    }
    roleId = (await prisma.role.findFirstOrThrow({ where: { name: 'MEMBER', isSystem: true } })).id
    const admin = await prisma.role.findFirstOrThrow({ where: { name: 'ADMIN', isSystem: true } })
    await seedOrgMember(prisma, { orgId, userId: owner.sub, roleId: admin.id })
  })
  const actor = () =>
    invitationActor({
      user: owner,
      privilegedAdmission: { authenticated: owner, principal: owner },
    })
  async function pending(assignedRole: string | null = roleId) {
    const token = randomBytes(32).toString('base64url')
    const invite = await prisma.orgInvite.create({
      data: {
        organizationId: orgId,
        email: recipient.email!,
        emailCanonical: recipient.email!,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        roleId: assignedRole,
        invitedById: owner.sub,
        expiresAt: new Date(Date.now() + 60000),
      },
    })
    return { token, invite }
  }
  const accept = (token: string) => invites.acceptInvite(token, recipient, '127.0.0.1')
  const outcome = (work: Promise<unknown>) =>
    carryInvitationBackend(
      work,
      work.then(
        () => 200,
        (e) => e.getStatus()
      )
    )
  const claim = () =>
    invitationFence(
      prisma,
      (model, method, args) =>
        model === '$sql' && method === '$queryRaw' && String(args[0]).includes('claim_clock')
    )
  const revoked = () =>
    invitationFence(prisma, (model, method) => model === 'orgInvite' && method === 'update')
  async function truth(id: string) {
    return {
      invite: await prisma.orgInvite.findUnique({ where: { id } }),
      members: await prisma.orgMember.findMany({
        where: { userId: recipient.sub },
        include: { roles: true },
      }),
      org: await prisma.organization.findUnique({ where: { id: orgId } }),
      audit: await prisma.auditLog.findMany({
        where: { action: 'org.invite_accepted', targetId: id },
      }),
    }
  }
  async function race(
    fence: ReturnType<typeof invitationFence>,
    first: () => Promise<unknown>,
    second: () => Promise<unknown>,
    query = 'core.organizations'
  ) {
    const winner = outcome(trackInvitationOperation(first))
    let loser: Promise<number> | undefined
    try {
      await fence.waitFor(winner)
      loser = outcome(trackInvitationOperation(second))
      await observeInvitationWait(pool, loser, fence.pid(), query)
      fence.release()
      return [await winner, await loser]
    } finally {
      fence.restore()
      await Promise.allSettled([winner, ...(loser ? [loser] : [])])
    }
  }
  const getFixture = () => ({
    context,
    prisma,
    pool,
    invites,
    orgId,
    owner,
    recipient,
    roleId,
    actor,
    pending,
    accept,
    outcome,
    claim,
    revoked,
    truth,
    race,
  })
  registerFenceProofs(getFixture)
  registerTransitionsProofs(getFixture)
  registerForeignKeysProofs(getFixture)
  registerIdentityProofs(getFixture)
  registerAuthorityProofs(getFixture)
  registerAdmittedAuthorityProofs(getFixture)
  registerExpiryProofs(getFixture)
  registerCleanupProofs(getFixture)
  registerDurabilityProofs(getFixture)
  registerBudgetsProofs(getFixture)
})
