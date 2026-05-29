import { createHash, randomBytes } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

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

/**
 * OB-02 Stage C — pending-invite HTTP surface e2e coverage.
 *
 * Covers the three new contracts:
 *
 *   - `POST /organizations/:orgId/members/invite` — uniform 202
 *     {status:'invited'} regardless of recipient platform state, plus
 *     rotation on duplicate.
 *   - `GET/DELETE /organizations/:orgId/invites` — bearer-only admin
 *     management of pending invites.
 *   - `POST /auth/invites/accept` — accepts a pending invite, attaches
 *     org membership at accept time, with non-enumerating negative paths.
 *
 * Also locks the credential matrix: invite create stays dual-auth per
 * ADR-034; the three new routes (list/revoke/accept) are bearer-only
 * and the e2e proves that API keys are rejected with 401.
 *
 * Tokens for accept-path testing are seeded directly into `OrgInvite`
 * via Prisma — `InviteService.createInvite()` deliberately does not
 * return the raw token (Stage D will deliver it by email).
 */

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

interface SeedInviteOptions {
  orgId: string
  email: string
  emailCanonical?: string
  roleId: string | null
  invitedById: string
  expiresAt?: Date
  acceptedAt?: Date | null
  acceptedByUserId?: string | null
  revokedAt?: Date | null
  revokedById?: string | null
}

async function seedInvite(
  prisma: PrismaService,
  opts: SeedInviteOptions
): Promise<{ inviteId: string; rawToken: string }> {
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(rawToken)
  const created = await prisma.orgInvite.create({
    data: {
      organizationId: opts.orgId,
      email: opts.email,
      emailCanonical: opts.emailCanonical ?? opts.email.toLowerCase().trim(),
      roleId: opts.roleId,
      invitedById: opts.invitedById,
      tokenHash,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + INVITE_EXPIRY_MS),
      acceptedAt: opts.acceptedAt ?? null,
      acceptedByUserId: opts.acceptedByUserId ?? null,
      revokedAt: opts.revokedAt ?? null,
      revokedById: opts.revokedById ?? null,
    },
    select: { id: true },
  })
  return { inviteId: created.id, rawToken }
}

describe('Invites (e2e — OB-02 Stage C)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  async function registerAndLogin(email: string, password = 'StrongP@ss123'): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    return res.body.accessToken as string
  }

  async function setupAdminOrg(email = 'admin@example.com'): Promise<{
    adminToken: string
    adminOrgToken: string
    orgId: string
    adminUserId: string
  }> {
    const adminToken = await registerAndLogin(email)
    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Acme Corp' })
      .expect(201)
    const orgId = orgRes.body.id as string

    const switchRes = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/switch`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
    const adminOrgToken = switchRes.body.accessToken as string

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    return { adminToken, adminOrgToken, orgId, adminUserId: me.body.user.id as string }
  }

  async function verifyEmail(emailCanonical: string): Promise<void> {
    await prisma.user.update({ where: { emailCanonical }, data: { emailVerified: true } })
  }

  /**
   * Uniform 202 across the create-invite branches that the recipient
   * could otherwise infer from response shape or status code:
   *
   *   - Branch A: target is already a member → silent no-op
   *   - Branch B: target is a registered user, not yet a member → pending
   *   - Branch C: target email has no account → pending
   *
   * All three must return the same `{ status: 'invited' }` body.
   */
  describe('POST /organizations/:orgId/members/invite — uniform 202 (non-enumeration)', () => {
    it('returns 202 {status:invited} when the email has no account', async () => {
      const { adminOrgToken, orgId } = await setupAdminOrg()
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .send({ email: 'unknown@example.com' })
        .expect(202)
      expect(res.body).toEqual({ status: 'invited' })
    })

    it('returns 202 {status:invited} when the email belongs to a registered non-member', async () => {
      const { adminOrgToken, orgId } = await setupAdminOrg()
      await registerAndLogin('member@example.com')

      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .send({ email: 'member@example.com' })
        .expect(202)
      expect(res.body).toEqual({ status: 'invited' })

      const invite = await prisma.orgInvite.findFirst({
        where: { organizationId: orgId, emailCanonical: 'member@example.com' },
      })
      expect(invite).not.toBeNull()
    })

    it('returns 202 {status:invited} when the email is already a member (silent no-op)', async () => {
      const { adminOrgToken, orgId, adminUserId } = await setupAdminOrg('owner@example.com')

      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .send({ email: 'owner@example.com' })
        .expect(202)
      expect(res.body).toEqual({ status: 'invited' })

      // No invite row materialized for the existing member — silent no-op.
      const invites = await prisma.orgInvite.findMany({ where: { organizationId: orgId } })
      expect(invites).toHaveLength(0)

      // And membership topology is unchanged.
      const members = await prisma.orgMember.findMany({ where: { organizationId: orgId } })
      expect(members).toHaveLength(1)
      expect(members[0]?.userId).toBe(adminUserId)
    })

    it('rotates the token on a repeated invite to the same email', async () => {
      const { adminOrgToken, orgId } = await setupAdminOrg()

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .send({ email: 'target@example.com' })
        .expect(202)

      const firstRow = await prisma.orgInvite.findFirstOrThrow({
        where: { organizationId: orgId, emailCanonical: 'target@example.com' },
        select: { id: true, tokenHash: true },
      })

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .send({ email: 'target@example.com' })
        .expect(202)

      const rows = await prisma.orgInvite.findMany({
        where: { organizationId: orgId, emailCanonical: 'target@example.com' },
        select: { id: true, tokenHash: true },
      })
      expect(rows).toHaveLength(1) // same row, rotated in place
      expect(rows[0]?.id).toBe(firstRow.id)
      expect(rows[0]?.tokenHash).not.toBe(firstRow.tokenHash)
    })

    it('rejects invite without org context with 403', async () => {
      const { adminToken, orgId } = await setupAdminOrg()
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${adminToken}`) // no /switch
        .send({ email: 'target@example.com' })
        .expect(403)
    })
  })

  describe('POST /auth/invites/accept', () => {
    async function inviteFor(
      orgId: string,
      adminUserId: string,
      roleId: string | null,
      email: string,
      overrides: Partial<Omit<SeedInviteOptions, 'orgId' | 'email' | 'invitedById' | 'roleId'>> = {}
    ): Promise<{ inviteId: string; rawToken: string }> {
      return seedInvite(prisma, {
        orgId,
        email,
        invitedById: adminUserId,
        roleId,
        ...overrides,
      })
    }

    it('attaches membership on success and returns {organizationId, roleId}', async () => {
      const { orgId, adminUserId } = await setupAdminOrg()
      const memberRoleRow = await prisma.role.findFirstOrThrow({
        where: { name: 'MEMBER', isSystem: true, organizationId: null },
      })

      const inviteeToken = await registerAndLogin('invitee@example.com')
      await verifyEmail('invitee@example.com')

      const { rawToken } = await inviteFor(
        orgId,
        adminUserId,
        memberRoleRow.id,
        'invitee@example.com'
      )

      const res = await request(app.getHttpServer())
        .post('/auth/invites/accept')
        .set('Authorization', `Bearer ${inviteeToken}`)
        .send({ token: rawToken })
        .expect(200)

      expect(res.body).toEqual({ organizationId: orgId, roleId: memberRoleRow.id })

      const inviteeUser = await prisma.user.findUniqueOrThrow({
        where: { emailCanonical: 'invitee@example.com' },
      })
      const member = await prisma.orgMember.findUnique({
        where: {
          userId_organizationId: { userId: inviteeUser.id, organizationId: orgId },
        },
      })
      expect(member).not.toBeNull()
    })

    type NegativeScenario = 'missing' | 'expired' | 'accepted' | 'revoked' | 'mismatch'
    it.each<[string, NegativeScenario]>([
      ['token does not exist', 'missing'],
      ['token expired', 'expired'],
      ['token already accepted', 'accepted'],
      ['token revoked', 'revoked'],
      ['email mismatch with current principal', 'mismatch'],
    ])('returns 400 INVITE_INVALID_OR_EXPIRED when %s', async (_label, scenario) => {
      const { orgId, adminUserId } = await setupAdminOrg()
      const memberRoleRow = await prisma.role.findFirstOrThrow({
        where: { name: 'MEMBER', isSystem: true, organizationId: null },
      })

      const inviteeToken = await registerAndLogin('invitee@example.com')
      await verifyEmail('invitee@example.com')

      let tokenToSend: string

      if (scenario === 'missing') {
        tokenToSend = randomBytes(32).toString('base64url')
      } else if (scenario === 'mismatch') {
        const { rawToken } = await inviteFor(
          orgId,
          adminUserId,
          memberRoleRow.id,
          'someone-else@example.com'
        )
        tokenToSend = rawToken
      } else {
        const overrides: Partial<SeedInviteOptions> = {}
        if (scenario === 'expired') {
          overrides.expiresAt = new Date(Date.now() - 1000)
        } else if (scenario === 'accepted') {
          overrides.acceptedAt = new Date()
          overrides.acceptedByUserId = adminUserId
        } else if (scenario === 'revoked') {
          overrides.revokedAt = new Date()
          overrides.revokedById = adminUserId
        }
        const { rawToken } = await inviteFor(
          orgId,
          adminUserId,
          memberRoleRow.id,
          'invitee@example.com',
          overrides
        )
        tokenToSend = rawToken
      }

      const res = await request(app.getHttpServer())
        .post('/auth/invites/accept')
        .set('Authorization', `Bearer ${inviteeToken}`)
        .send({ token: tokenToSend })
        .expect(400)
      expect(res.body.errorCode).toBe('INVITE_INVALID_OR_EXPIRED')
    })

    it('returns 403 INVITE_EMAIL_NOT_VERIFIED when the accepting user has an unverified email', async () => {
      const { orgId, adminUserId } = await setupAdminOrg()
      const memberRoleRow = await prisma.role.findFirstOrThrow({
        where: { name: 'MEMBER', isSystem: true, organizationId: null },
      })

      const inviteeToken = await registerAndLogin('invitee@example.com')
      // Intentionally do NOT verify email.
      const { rawToken } = await inviteFor(
        orgId,
        adminUserId,
        memberRoleRow.id,
        'invitee@example.com'
      )

      const res = await request(app.getHttpServer())
        .post('/auth/invites/accept')
        .set('Authorization', `Bearer ${inviteeToken}`)
        .send({ token: rawToken })
        .expect(403)
      expect(res.body.errorCode).toBe('INVITE_EMAIL_NOT_VERIFIED')
    })

    it('rejects accept without bearer token (401)', async () => {
      await request(app.getHttpServer())
        .post('/auth/invites/accept')
        .send({ token: randomBytes(32).toString('base64url') })
        .expect(401)
    })
  })

  describe('GET /organizations/:orgId/invites', () => {
    it('returns canonical paginated envelope with active invites only', async () => {
      const { adminOrgToken, orgId, adminUserId } = await setupAdminOrg()
      const memberRoleRow = await prisma.role.findFirstOrThrow({
        where: { name: 'MEMBER', isSystem: true, organizationId: null },
      })

      await seedInvite(prisma, {
        orgId,
        email: 'active@example.com',
        invitedById: adminUserId,
        roleId: memberRoleRow.id,
      })
      await seedInvite(prisma, {
        orgId,
        email: 'expired@example.com',
        invitedById: adminUserId,
        roleId: memberRoleRow.id,
        expiresAt: new Date(Date.now() - 1000),
      })
      await seedInvite(prisma, {
        orgId,
        email: 'revoked@example.com',
        invitedById: adminUserId,
        roleId: memberRoleRow.id,
        revokedAt: new Date(),
        revokedById: adminUserId,
      })
      await seedInvite(prisma, {
        orgId,
        email: 'accepted@example.com',
        invitedById: adminUserId,
        roleId: memberRoleRow.id,
        acceptedAt: new Date(),
        acceptedByUserId: adminUserId,
      })

      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/invites`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .expect(200)

      expect(res.body.data).toHaveLength(1)
      expect(res.body.total).toBe(1)
      expect(res.body.page).toBe(1)
      expect(res.body.limit).toBe(20)
      expect(res.body.data[0]).toMatchObject({ email: 'active@example.com' })
      // No raw token or hash should leak in the list response.
      expect(res.body.data[0]).not.toHaveProperty('token')
      expect(res.body.data[0]).not.toHaveProperty('tokenHash')
    })

    it('returns 403 when the principal is switched to a different org (path mismatch)', async () => {
      const { orgId: orgA, adminToken: tokenA } = await setupAdminOrg('user-a@example.com')
      const { adminToken: tokenB } = await setupAdminOrg('user-b@example.com')

      // Switch tokenB into their own org so principal.organizationId !== orgA.
      const orgBRes = await request(app.getHttpServer())
        .get('/organizations')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200)
      const orgB = orgBRes.body.data[0].id as string
      const switchB = await request(app.getHttpServer())
        .post(`/organizations/${orgB}/switch`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200)
      const orgBToken = switchB.body.accessToken as string

      // tokenA is not relevant to the path-mismatch assertion; sanity-only.
      expect(typeof tokenA).toBe('string')

      await request(app.getHttpServer())
        .get(`/organizations/${orgA}/invites`)
        .set('Authorization', `Bearer ${orgBToken}`)
        .expect(403)
    })
  })

  describe('DELETE /organizations/:orgId/invites/:inviteId', () => {
    it('revokes a pending invite (204) and lookups marked revoked', async () => {
      const { adminOrgToken, orgId, adminUserId } = await setupAdminOrg()
      const { inviteId } = await seedInvite(prisma, {
        orgId,
        email: 'target@example.com',
        invitedById: adminUserId,
        roleId: null,
      })

      await request(app.getHttpServer())
        .delete(`/organizations/${orgId}/invites/${inviteId}`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .expect(204)

      const row = await prisma.orgInvite.findUniqueOrThrow({ where: { id: inviteId } })
      expect(row.revokedAt).not.toBeNull()
      expect(row.revokedById).toBe(adminUserId)
    })

    it('is idempotent — revoking an already-revoked invite returns 204', async () => {
      const { adminOrgToken, orgId, adminUserId } = await setupAdminOrg()
      const { inviteId } = await seedInvite(prisma, {
        orgId,
        email: 'target@example.com',
        invitedById: adminUserId,
        roleId: null,
        revokedAt: new Date(),
        revokedById: adminUserId,
      })

      await request(app.getHttpServer())
        .delete(`/organizations/${orgId}/invites/${inviteId}`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .expect(204)
    })

    it('returns 400 BUSINESS_RULE_VIOLATION when revoking an accepted invite', async () => {
      const { adminOrgToken, orgId, adminUserId } = await setupAdminOrg()
      const { inviteId } = await seedInvite(prisma, {
        orgId,
        email: 'target@example.com',
        invitedById: adminUserId,
        roleId: null,
        acceptedAt: new Date(),
        acceptedByUserId: adminUserId,
      })

      const res = await request(app.getHttpServer())
        .delete(`/organizations/${orgId}/invites/${inviteId}`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .expect(400)
      expect(res.body.errorCode).toBe('BUSINESS_RULE_VIOLATION')
    })

    it('returns 404 when inviteId belongs to a different organization (current org context)', async () => {
      const { adminOrgToken: tokenA, orgId: orgA } = await setupAdminOrg('user-a@example.com')
      const { orgId: orgB, adminUserId: adminBId } = await setupAdminOrg('user-b@example.com')
      const { inviteId } = await seedInvite(prisma, {
        orgId: orgB,
        email: 'target@example.com',
        invitedById: adminBId,
        roleId: null,
      })

      await request(app.getHttpServer())
        .delete(`/organizations/${orgA}/invites/${inviteId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404)
    })
  })

  /**
   * Credential matrix lock — ADR-034 + OB-02 Stage C:
   *   - create invite remains dual-auth (existing allowlist entry)
   *   - list / revoke / accept are bearer-only (new routes, no allowlist
   *     entry, and adding one would require an ADR amendment)
   *
   * The four cases below pin the runtime behaviour so accidental drift
   * either way fails an e2e immediately.
   */
  describe('OB-02: credential boundary on the invite surface', () => {
    it('POST /organizations/:orgId/members/invite accepts an API key (dual-auth preserved)', async () => {
      const { adminToken, orgId } = await setupAdminOrg()
      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Invite key',
          organizationId: orgId,
          scopes: ['manage:Organization'],
        })
        .expect(201)
      const apiKey = keyRes.body.key as string

      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ email: 'target@example.com' })
        .expect(202)
      expect(res.body).toEqual({ status: 'invited' })
    })

    it('GET /organizations/:orgId/invites rejects API keys with 401', async () => {
      const { adminToken, orgId } = await setupAdminOrg()
      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'List attempt',
          organizationId: orgId,
          scopes: ['manage:Organization'],
        })
        .expect(201)
      const apiKey = keyRes.body.key as string

      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/invites`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401)
    })

    it('DELETE /organizations/:orgId/invites/:inviteId rejects API keys with 401', async () => {
      const { adminToken, orgId, adminUserId } = await setupAdminOrg()
      const { inviteId } = await seedInvite(prisma, {
        orgId,
        email: 'target@example.com',
        invitedById: adminUserId,
        roleId: null,
      })

      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Revoke attempt',
          organizationId: orgId,
          scopes: ['manage:Organization'],
        })
        .expect(201)
      const apiKey = keyRes.body.key as string

      await request(app.getHttpServer())
        .delete(`/organizations/${orgId}/invites/${inviteId}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401)
    })

    it('POST /auth/invites/accept rejects API keys with 401', async () => {
      const { adminToken, orgId } = await setupAdminOrg()
      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Accept attempt',
          organizationId: orgId,
          scopes: ['read:all'],
        })
        .expect(201)
      const apiKey = keyRes.body.key as string

      await request(app.getHttpServer())
        .post('/auth/invites/accept')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ token: randomBytes(32).toString('base64url') })
        .expect(401)
    })

    /**
     * Cross-org boundary on the (dual-auth) invite-create route. An API
     * key is an org-bound credential per ADR-033; `InviteService.createInvite`
     * calls `assertOrgContext(principal, orgId)` before any write, so a key
     * bound to org A cannot invite into org B.
     *
     * The expected status is 403, not 401: the route is dual-auth so the key
     * authenticates, and the owner is seeded into org B as a MEMBER below, so
     * a membership-only check would pass — the denial must come from the
     * org-context boundary, not from a missing membership or a malformed key.
     * The scope is `manage:Organization` so `@CheckPolicies(Manage,
     * Organization)` passes and the 403 originates at the org-context
     * assertion, not at authorization.
     */
    it('POST /organizations/:orgId/members/invite rejects an API key bound to a different org with 403', async () => {
      // userA — admin of org A.
      const {
        adminToken: tokenA,
        orgId: orgA,
        adminUserId: userAId,
      } = await setupAdminOrg('user-a@example.com')

      // userB — owns org B.
      const tokenB = await registerAndLogin('user-b@example.com')
      const orgBRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Org B' })
        .expect(201)
      const orgB = orgBRes.body.id as string

      // Seed userA into org B as MEMBER directly — a membership-only check
      // would now pass, so the 403 below must come from the bound-org boundary.
      const memberRole = await prisma.role.findFirstOrThrow({
        where: { name: 'MEMBER', isSystem: true, organizationId: null },
      })
      await seedOrgMember(prisma, { orgId: orgB, userId: userAId, roleId: memberRole.id })
      const orgBMembers = await prisma.orgMember.findMany({ where: { organizationId: orgB } })
      expect(orgBMembers).toHaveLength(2)

      // userA creates an API key bound to org A only.
      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Bound to A', organizationId: orgA, scopes: ['manage:Organization'] })
        .expect(201)
      const apiKey = keyRes.body.key as string

      // Cross-org invite — rejected with 403 (credential bound to org A).
      await request(app.getHttpServer())
        .post(`/organizations/${orgB}/members/invite`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ email: 'cross-org-target@example.com' })
        .expect(403)

      // No partial write: the rejected call created no invite row in org B.
      const leaked = await prisma.orgInvite.findFirst({
        where: { organizationId: orgB, emailCanonical: 'cross-org-target@example.com' },
      })
      expect(leaked).toBeNull()
    })
  })
})
