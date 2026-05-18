import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

describe('Organizations (e2e)', () => {
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

  /** Register a user and return their access token */
  async function registerAndLogin(email: string, password = 'StrongP@ss123') {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    return res.body.accessToken as string
  }

  describe('POST /organizations', () => {
    it('creates org and returns it', async () => {
      const token = await registerAndLogin('admin@example.com')

      const res = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corp', slug: 'acme' })
        .expect(201)

      expect(res.body).toMatchObject({ name: 'Acme Corp', slug: 'acme' })
    })

    it('returns 401 without token', async () => {
      await request(app.getHttpServer()).post('/organizations').send({ name: 'Test' }).expect(401)
    })
  })

  describe('GET /organizations', () => {
    it('returns orgs the user belongs to', async () => {
      const token = await registerAndLogin('admin@example.com')
      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corp' })

      const res = await request(app.getHttpServer())
        .get('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(res.body).toHaveLength(1)
      expect(res.body[0]).toMatchObject({ name: 'Acme Corp' })
    })
  })

  describe('POST /organizations/:id/switch', () => {
    it('returns new access token with org context', async () => {
      const token = await registerAndLogin('admin@example.com')
      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corp' })

      const orgId = orgRes.body.id as string

      const switchRes = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/switch`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(switchRes.body.accessToken).toBeDefined()
      expect(typeof switchRes.body.accessToken).toBe('string')
    })

    it('returns 403 when user is not a member', async () => {
      const adminToken = await registerAndLogin('admin@example.com')
      const otherToken = await registerAndLogin('other@example.com')

      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Acme Corp' })

      await request(app.getHttpServer())
        .post(`/organizations/${orgRes.body.id}/switch`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403)
    })

    /**
     * OA-01: bearer-only. An API key — even one bound to this exact org —
     * must not be convertible into a JWT. Otherwise a narrowly-scoped
     * integration credential could mint a full-permission token for the
     * owner, bypassing `userPerms ∩ scopes` (ADR-033), and could even
     * target a different organization the owner happens to belong to.
     * See `ai/ORGANIZATIONS_ADMIN_REVIEW.md` OA-01.
     */
    it('OA-01: rejects API key with 401, even when bound to the target org', async () => {
      const token = await registerAndLogin('owner@example.com')

      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corp' })
      const orgId = orgRes.body.id as string

      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Switch attempt', organizationId: orgId, scopes: ['read:User'] })
        .expect(201)
      const apiKey = keyRes.body.key as string

      // Sanity: the API key authenticates on a route that accepts it,
      // proving 401 below is the auth-type policy and not a malformed key.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200)

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/switch`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401)
    })
  })

  /**
   * OA-03: API keys are organization-bound credentials per ADR-033 and
   * must not operate outside that boundary on the org lifecycle/read
   * surface. After Stage 2:
   *
   *   - `POST /organizations` and `GET /organizations` are JWT-only
   *     (creation is interactive; listing leaks owner's org topology).
   *   - `GET /organizations/:id` accepts API keys only when
   *     `principal.organizationId === :id` (`OrganizationsService.findOne`
   *     discriminating check); JWT principals keep the existing
   *     membership-based read.
   *
   * The cross-org test below explicitly invites the API-key owner into
   * the foreign org first, so the membership check passes — proving
   * the 403 fires from the OA-03 boundary, not from a missing
   * membership.
   */
  describe('OA-03: api keys cannot operate outside their bound org', () => {
    it('rejects POST /organizations with 401 (JWT-only — would otherwise let a scoped key spin up a new org with owner as admin)', async () => {
      const token = await registerAndLogin('owner@example.com')
      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme' })
        .expect(201)

      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Create attempt',
          organizationId: orgRes.body.id as string,
          scopes: ['read:Organization'],
        })
        .expect(201)
      const apiKey = keyRes.body.key as string

      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ name: 'Should not be created' })
        .expect(401)
    })

    it('rejects GET /organizations with 401 (JWT-only — would otherwise leak the owner org-membership topology)', async () => {
      const token = await registerAndLogin('owner@example.com')
      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme' })
        .expect(201)

      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'List attempt',
          organizationId: orgRes.body.id as string,
          scopes: ['read:Organization'],
        })
        .expect(201)
      const apiKey = keyRes.body.key as string

      await request(app.getHttpServer())
        .get('/organizations')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401)
    })

    it('rejects GET /organizations/:id with 403 when api key is bound to that org but scope does not include read:Organization (userPerms ∩ scopes per ADR-033)', async () => {
      const token = await registerAndLogin('owner@example.com')
      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme' })
        .expect(201)
      const orgId = orgRes.body.id as string

      // Key bound to the exact same org, but scope is read:User —
      // owner is ADMIN of this org (so userPerms include
      // manage:Organization), but the intersection with read:User
      // narrows to nothing on the Organization axis. The bound-org
      // check would pass; the ability check is what catches this.
      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'User-scoped key',
          organizationId: orgId,
          scopes: ['read:User'],
        })
        .expect(201)
      const apiKey = keyRes.body.key as string

      // Sanity: the key is well-formed and authenticates on a route
      // that accepts API keys (here /auth/me) — proves the 403 below
      // is the ability check, not auth-type or malformed-key.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200)

      await request(app.getHttpServer())
        .get(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(403)
    })

    it('allows GET /organizations/:id when the api key is bound to that exact org', async () => {
      const token = await registerAndLogin('owner@example.com')
      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme' })
        .expect(201)
      const orgId = orgRes.body.id as string

      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Own-org reader',
          organizationId: orgId,
          scopes: ['read:Organization'],
        })
        .expect(201)
      const apiKey = keyRes.body.key as string

      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200)

      expect(res.body.id).toBe(orgId)
    })

    it('rejects GET /organizations/:id with 403 when api key targets a different org (owner is a member of both — proves the bound-org boundary fires, not the generic membership check)', async () => {
      // userA owns org A.
      const tokenA = await registerAndLogin('user-a@example.com')
      const orgARes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Org A' })
        .expect(201)
      const orgA = orgARes.body.id as string

      // userB owns org B.
      const tokenB = await registerAndLogin('user-b@example.com')
      const orgBRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Org B' })
        .expect(201)
      const orgB = orgBRes.body.id as string

      // userB switches into org B and invites userA as a MEMBER.
      const switchRes = await request(app.getHttpServer())
        .post(`/organizations/${orgB}/switch`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200)
      const orgBToken = switchRes.body.accessToken as string

      const rolesRes = await request(app.getHttpServer())
        .get(`/organizations/${orgB}/roles`)
        .set('Authorization', `Bearer ${orgBToken}`)
        .expect(200)
      const memberRole = rolesRes.body.find((r: { name: string }) => r.name === 'MEMBER')

      await request(app.getHttpServer())
        .post(`/organizations/${orgB}/members/invite`)
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({ email: 'user-a@example.com', roleId: memberRole.id })
        .expect(201)

      // Sanity: userA is now a member of BOTH org A and org B. A
      // membership-only check would let the cross-org read through —
      // the 403 below must come from OA-03's bound-org boundary.
      const orgBMembers = await prisma.orgMember.findMany({ where: { organizationId: orgB } })
      expect(orgBMembers).toHaveLength(2)

      // userA creates an API key bound to org A only.
      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Bound to A', organizationId: orgA, scopes: ['read:Organization'] })
        .expect(201)
      const apiKey = keyRes.body.key as string

      // Own org — allowed (sanity that the key works at all).
      await request(app.getHttpServer())
        .get(`/organizations/${orgA}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200)

      // Cross-org — rejected with 403, NOT 404 (this is a credential-
      // boundary violation, not org-existence concealment) and NOT a
      // membership 403 (owner is a member, established above).
      await request(app.getHttpServer())
        .get(`/organizations/${orgB}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(403)
    })
  })

  describe('Org-protected endpoints (require org context)', () => {
    let adminToken: string
    let orgToken: string
    let orgId: string

    beforeEach(async () => {
      adminToken = await registerAndLogin('admin@example.com')
      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Acme Corp' })
      orgId = orgRes.body.id as string

      const switchRes = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/switch`)
        .set('Authorization', `Bearer ${adminToken}`)
      orgToken = switchRes.body.accessToken as string
    })

    it('GET /organizations/:id/roles — returns system roles with org context', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${orgToken}`)
        .expect(200)

      const names = res.body.map((r: { name: string }) => r.name)
      expect(names).toContain('ADMIN')
      expect(names).toContain('MEMBER')
      expect(names).toContain('VIEWER')
    })

    it('GET /organizations/:id/roles — returns 403 without org context', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403)
    })

    it('POST /organizations/:id/members/invite — invites existing user as MEMBER', async () => {
      await registerAndLogin('member@example.com')

      const rolesRes = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${orgToken}`)
      const memberRole = rolesRes.body.find((r: { name: string }) => r.name === 'MEMBER')

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${orgToken}`)
        .send({ email: 'Member@Example.COM', roleId: memberRole.id })
        .expect(201)

      const members = await prisma.orgMember.findMany({ where: { organizationId: orgId } })
      expect(members).toHaveLength(2)
    })

    it('POST /organizations/:id/roles — creates custom role', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${orgToken}`)
        .send({ name: 'Editor', description: 'Can edit content' })
        .expect(201)

      expect(res.body).toMatchObject({ name: 'Editor', organizationId: orgId })
    })

    /**
     * OA-09 companion: last-admin guard end-to-end. Owner is the
     * only admin in this org by construction (creator becomes admin
     * via the org-create flow); removing them as a member or stripping
     * their ADMIN role must return 400 + BUSINESS_RULE_VIOLATION.
     */
    describe('OA-09 companion: protect last org admin', () => {
      let adminUserId: string
      let adminRoleId: string

      beforeEach(async () => {
        const meRes = await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer ${orgToken}`)
          .expect(200)
        adminUserId = meRes.body.user.id as string

        const rolesRes = await request(app.getHttpServer())
          .get(`/organizations/${orgId}/roles`)
          .set('Authorization', `Bearer ${orgToken}`)
          .expect(200)
        adminRoleId = rolesRes.body.find((r: { name: string }) => r.name === 'ADMIN').id
      })

      it('blocks removing the last admin member', async () => {
        const res = await request(app.getHttpServer())
          .delete(`/organizations/${orgId}/members/${adminUserId}`)
          .set('Authorization', `Bearer ${orgToken}`)
          .expect(400)

        expect(res.body.errorCode).toBe('BUSINESS_RULE_VIOLATION')
      })

      it('blocks stripping the last admin role from the only admin', async () => {
        const res = await request(app.getHttpServer())
          .delete(`/organizations/${orgId}/members/${adminUserId}/roles/${adminRoleId}`)
          .set('Authorization', `Bearer ${orgToken}`)
          .expect(400)

        expect(res.body.errorCode).toBe('BUSINESS_RULE_VIOLATION')
      })
    })
  })

  /**
   * OA-05: role ownership invariant. A member of org A must never be
   * assigned a custom role owned by org B. The unit suite covers the
   * service-level branches; this e2e proves the boundary holds end-to-
   * end on the real invite route, including the uniform 403 response
   * that prevents roleId enumeration.
   */
  describe('OA-05: role ownership across orgs', () => {
    it('rejects invite carrying a custom roleId from a different organization with 403', async () => {
      // userA admin in org A.
      const tokenA = await registerAndLogin('user-a@example.com')
      const orgARes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Org A' })
        .expect(201)
      const orgA = orgARes.body.id as string
      const switchARes = await request(app.getHttpServer())
        .post(`/organizations/${orgA}/switch`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200)
      const orgAToken = switchARes.body.accessToken as string

      // userB admin in org B; creates a custom role X scoped to org B.
      const tokenB = await registerAndLogin('user-b@example.com')
      const orgBRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Org B' })
        .expect(201)
      const orgB = orgBRes.body.id as string
      const switchBRes = await request(app.getHttpServer())
        .post(`/organizations/${orgB}/switch`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200)
      const orgBToken = switchBRes.body.accessToken as string

      const foreignRoleRes = await request(app.getHttpServer())
        .post(`/organizations/${orgB}/roles`)
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({ name: 'OrgB-Editor', description: 'Belongs to org B only' })
        .expect(201)
      const foreignRoleId = foreignRoleRes.body.id as string

      // Register a target user (must exist for the invite-by-email
      // lookup to succeed; otherwise we'd get a 404 from the user
      // lookup and would not exercise the role-ownership branch).
      await registerAndLogin('target@example.com')

      // userA (admin in org A) attempts to invite target into org A
      // with the foreign roleId from org B → must be 403, NOT 404
      // (uniform with the "roleId does not exist" path so an attacker
      // cannot enumerate roleIds across orgs via status code).
      await request(app.getHttpServer())
        .post(`/organizations/${orgA}/members/invite`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ email: 'target@example.com', roleId: foreignRoleId })
        .expect(403)

      // No membership should have been created for the target — proves
      // the rejection fires before the org-member write.
      const orgAMembers = await prisma.orgMember.findMany({ where: { organizationId: orgA } })
      // Only userA (admin) should be a member of org A.
      expect(orgAMembers).toHaveLength(1)
    })

    it('returns 403 for non-existent roleId — uniform with foreign-org rejection (no enumeration)', async () => {
      const token = await registerAndLogin('admin@example.com')
      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme' })
        .expect(201)
      const orgId = orgRes.body.id as string
      const switchRes = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/switch`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      const orgToken = switchRes.body.accessToken as string

      await registerAndLogin('target@example.com')

      // Bogus roleId — must come back as 403 (same code as the
      // foreign-org case above), not 404. A 404 here would confirm
      // "this roleId does not exist", letting an attacker distinguish
      // foreign vs missing roleIds.
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${orgToken}`)
        .send({ email: 'target@example.com', roleId: 'cmp9aaaaa0000000000000000' })
        .expect(403)
    })
  })

  /**
   * OA-06: `GET /organizations/:orgId/roles` carried a function-level
   * `@CheckPolicies(Manage, Organization)` but no per-orgId boundary
   * check. An admin switched into org A could call the route with
   * `:orgId = orgB` and read org B's role + permission catalogue —
   * canonical OWASP API1:2023 BOLA. Service-level `assertOrgContext`
   * now binds `:orgId` to `principal.organizationId`.
   */
  describe('OA-06: list roles requires matching org context', () => {
    it('rejects GET /organizations/:orgB/roles when the admin is switched into org A', async () => {
      // userA admin in org A.
      const tokenA = await registerAndLogin('user-a@example.com')
      const orgARes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Org A' })
        .expect(201)
      const orgA = orgARes.body.id as string
      const switchARes = await request(app.getHttpServer())
        .post(`/organizations/${orgA}/switch`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200)
      const orgAToken = switchARes.body.accessToken as string

      // userB admin in org B. Creates a custom role so the leak
      // surface (org-B catalogue) is non-trivial — the test would
      // still hold with only system roles, but a custom role makes
      // the leak concretely visible if the boundary were absent.
      const tokenB = await registerAndLogin('user-b@example.com')
      const orgBRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Org B' })
        .expect(201)
      const orgB = orgBRes.body.id as string
      const switchBRes = await request(app.getHttpServer())
        .post(`/organizations/${orgB}/switch`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200)
      const orgBToken = switchBRes.body.accessToken as string

      await request(app.getHttpServer())
        .post(`/organizations/${orgB}/roles`)
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({ name: 'OrgB-Secret', description: 'Should not leak across orgs' })
        .expect(201)

      // userA, switched into org A, asks for org B's roles. The
      // function-level @CheckPolicies on the controller was already
      // satisfied (userA holds manage:Organization in org A), so
      // before OA-06 this would have been 200 with org B's catalogue.
      // After OA-06 the service-level assertOrgContext rejects with
      // 403 *before* the catalogue read.
      await request(app.getHttpServer())
        .get(`/organizations/${orgB}/roles`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .expect(403)
    })

    it('allows GET /organizations/:orgA/roles when the admin is switched into the same org A', async () => {
      const token = await registerAndLogin('admin@example.com')
      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme' })
        .expect(201)
      const orgId = orgRes.body.id as string
      const switchRes = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/switch`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      const orgToken = switchRes.body.accessToken as string

      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${orgToken}`)
        .expect(200)

      const names = res.body.map((r: { name: string }) => r.name)
      expect(names).toEqual(expect.arrayContaining(['ADMIN', 'MEMBER', 'VIEWER']))
    })
  })

  /**
   * OA-04/OA-12: role changes must affect already-issued JWTs on the
   * next request. The first target request below warms the permissions
   * cache under the old aclVersion; removing ADMIN bumps aclVersion in
   * the same DB transaction and invalidates the org aclVersion cache.
   * The second request reuses the same target JWT and must see the new
   * version immediately.
   */
  describe('OA-04/OA-12: RBAC freshness for stale JWT aclVersion', () => {
    it('revokes role permissions on the next request without waiting for JWT refresh', async () => {
      const adminToken = await registerAndLogin('admin@example.com')
      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Acme' })
        .expect(201)
      const orgId = orgRes.body.id as string
      const adminOrgToken = (
        await request(app.getHttpServer())
          .post(`/organizations/${orgId}/switch`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200)
      ).body.accessToken as string

      await registerAndLogin('target@example.com')
      const rolesRes = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .expect(200)
      const adminRole = rolesRes.body.find((r: { name: string }) => r.name === 'ADMIN')
      expect(adminRole?.id).toBeDefined()

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .send({ email: 'target@example.com', roleId: adminRole.id })
        .expect(201)

      const targetLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'target@example.com', password: 'StrongP@ss123' })
        .expect(200)
      const targetOrgToken = (
        await request(app.getHttpServer())
          .post(`/organizations/${orgId}/switch`)
          .set('Authorization', `Bearer ${targetLogin.body.accessToken as string}`)
          .expect(200)
      ).body.accessToken as string

      // Warm permissions cache for target at the old aclVersion.
      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${targetOrgToken}`)
        .expect(200)

      await request(app.getHttpServer())
        .delete(`/organizations/${orgId}/members/${targetLogin.body.user.id}/roles/${adminRole.id}`)
        .set('Authorization', `Bearer ${adminOrgToken}`)
        .expect(204)

      // Same JWT, no refresh. Must see current aclVersion and lose
      // manage:Organization immediately.
      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${targetOrgToken}`)
        .expect(403)
    })
  })
})
