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

describe('API Keys (e2e)', () => {
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

  async function registerAndGetToken(email: string, password = 'StrongP@ss123') {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    return { token: res.body.accessToken as string, userId: res.body.user.id as string }
  }

  async function createOrganization(token: string, name = 'Acme', slug?: string) {
    const res = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, ...(slug ? { slug } : {}) })
      .expect(201)
    return res.body.id as string
  }

  async function registerWithOrg(email: string, orgName = 'Acme', orgSlug?: string) {
    const { token, userId } = await registerAndGetToken(email)
    const organizationId = await createOrganization(token, orgName, orgSlug)
    return { token, userId, organizationId }
  }

  async function createApiKey(
    token: string,
    organizationId: string,
    name = 'Test Key',
    scopes = ['read:User']
  ) {
    const res = await request(app.getHttpServer())
      .post('/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, organizationId, scopes })
      .expect(201)
    return res.body as {
      id: string
      key: string
      name: string
      organizationId: string
      scopes: string[]
    }
  }

  describe('POST /api-keys', () => {
    it('creates key and returns full key value once', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')

      const res = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'My Integration', organizationId, scopes: ['read:User'] })
        .expect(201)

      expect(res.body.id).toBeDefined()
      expect(res.body.key).toMatch(/^amcore_live_/)
      expect(res.body.name).toBe('My Integration')
      expect(res.body.organizationId).toBe(organizationId)
      expect(res.body.scopes).toEqual(['read:User'])
      expect(res.body).not.toHaveProperty('keyHash')
      expect(res.body).not.toHaveProperty('salt')
    })

    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .post('/api-keys')
        .send({ name: 'Key', organizationId: 'cuid', scopes: ['read:User'] })
        .expect(401)
    })
  })

  describe('GET /api-keys', () => {
    it('lists keys without secret fields', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      await createApiKey(token, organizationId, 'Key One', ['read:User'])
      await createApiKey(token, organizationId, 'Key Two', ['read:User'])

      const res = await request(app.getHttpServer())
        .get('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body).toHaveLength(2)
      expect(res.body[0]).not.toHaveProperty('key')
      expect(res.body[0]).not.toHaveProperty('keyHash')
      expect(res.body[0]).not.toHaveProperty('salt')
      expect(res.body[0]).toHaveProperty('id')
      expect(res.body[0]).toHaveProperty('name')
      expect(res.body[0]).toHaveProperty('organizationId')
      expect(res.body[0]).toHaveProperty('scopes')
    })
  })

  describe('DELETE /api-keys/:id', () => {
    it('revokes own key and returns 204', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { id } = await createApiKey(token, organizationId)

      await request(app.getHttpServer())
        .delete(`/api-keys/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204)
    })

    it("returns 404 for another user's key", async () => {
      const { token: token1, organizationId: org1 } = await registerWithOrg(
        'user1@example.com',
        'Org One',
        'org-one'
      )
      const { token: token2 } = await registerWithOrg('user2@example.com', 'Org Two', 'org-two')
      const { id } = await createApiKey(token1, org1)

      await request(app.getHttpServer())
        .delete(`/api-keys/${id}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(404)
    })
  })

  describe('using api key for authentication', () => {
    it('authenticates GET /auth/me with valid api key', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'CI Key', ['read:User'])

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${key}`)
        .expect(200)

      expect(res.body.user).toBeDefined()
      expect(res.body.user.email).toBe('user@example.com')
    })

    it('returns 401 after key is revoked', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key, id } = await createApiKey(token, organizationId, 'Temp Key', ['read:User'])

      await request(app.getHttpServer())
        .delete(`/api-keys/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204)

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${key}`)
        .expect(401)
    })
  })

  /**
   * AK-01: credential management routes are bearer-only.
   *
   * An API key must not be able to issue, enumerate, or revoke API keys —
   * even keys belonging to its own owner. The invariant is enforced by
   * `@Auth(AuthType.Bearer)` on `ApiKeysController`.
   */
  describe('AK-01: api keys cannot manage credentials', () => {
    it('rejects POST /api-keys with api key auth', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'Carrier', ['read:User'])

      await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${key}`)
        .send({ name: 'Should not be created', organizationId, scopes: ['read:User'] })
        .expect(401)
    })

    it('rejects GET /api-keys with api key auth', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'Carrier', ['read:User'])

      await request(app.getHttpServer())
        .get('/api-keys')
        .set('Authorization', `Bearer ${key}`)
        .expect(401)
    })

    it('rejects DELETE /api-keys/:id with api key auth', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'Carrier', ['read:User'])
      const { id: targetId } = await createApiKey(token, organizationId, 'Target', ['read:User'])

      await request(app.getHttpServer())
        .delete(`/api-keys/${targetId}`)
        .set('Authorization', `Bearer ${key}`)
        .expect(401)

      // Target key still exists and authenticates
      await request(app.getHttpServer())
        .get('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .then((res) => {
          expect((res.body as Array<{ id: string }>).some((k) => k.id === targetId)).toBe(true)
        })
    })
  })

  /**
   * AK-04 / ADR-033: API keys are organization-scoped credentials.
   *
   * - `organizationId` is required on the create-key payload (no implicit
   *   "current org from JWT").
   * - The creator must be a member of the bound organization at creation
   *   time (`ApiKeysService.create()` membership check).
   * - The principal built from an API key carries `organizationId` +
   *   `aclVersion`; the credential continues to authenticate while the
   *   owner remains a member of that org.
   *
   * End-to-end proof of scope×org authorization on a policy-protected
   * route lives in the AK-10 describe block below (added 2026-05-16,
   * after AK-09 wildcard-aware intersection landed).
   */
  describe('AK-04: api keys bind to organization', () => {
    it('rejects POST /api-keys without organizationId', async () => {
      const { token } = await registerWithOrg('user@example.com')

      const res = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Missing org', scopes: ['read:User'] })
        .expect(400)

      expect(res.body).toBeDefined()
    })

    it('rejects POST /api-keys when user is not a member of the org', async () => {
      const { token: tokenA } = await registerWithOrg('a@example.com', 'Org A', 'org-a')
      const { organizationId: orgB } = await registerWithOrg('b@example.com', 'Org B', 'org-b')

      await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Cross-org', organizationId: orgB, scopes: ['read:User'] })
        .expect(403)
    })

    it('creates key when user is a member of the org', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')

      const res = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Own org', organizationId, scopes: ['read:User'] })
        .expect(201)

      expect(res.body.organizationId).toBe(organizationId)
    })

    it('key authenticates /auth/me after creation (proves org-bound principal is built)', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'Auth proof', ['read:User'])

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${key}`)
        .expect(200)
    })
  })

  /**
   * AK-10: scope authorization on a policy-protected route.
   *
   * Before AK-09 landed, the api-keys e2e suite only hit `/auth/me`,
   * which has no `@CheckPolicies` handler — so the tests proved
   * authentication but never exercised the CASL `userPerms ∩ scopes`
   * model. This block targets `PATCH /organizations/:id`, which is
   * guarded by `@CheckPolicies(can(Manage, Organization))`, and proves
   * that wildcard-aware intersection (Stage 4) behaves correctly under
   * a real authorization decision.
   *
   * Setup for every case: the registering user creates the organization
   * → becomes ADMIN → holds `manage:Organization` in seeded permissions.
   * The api-key is bound to that same org. Only the scope differs.
   */
  describe('AK-10: scope authorization on policy-protected route', () => {
    it('manage:Organization → 200 on PATCH /organizations/:id', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'Manager', ['manage:Organization'])

      const res = await request(app.getHttpServer())
        .patch(`/organizations/${organizationId}`)
        .set('Authorization', `Bearer ${key}`)
        .send({ name: 'Updated Org' })
        .expect(200)

      expect(res.body.name).toBe('Updated Org')
    })

    it('read:Organization → 403 (action narrows to read; PATCH needs Manage)', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'Reader', ['read:Organization'])

      await request(app.getHttpServer())
        .patch(`/organizations/${organizationId}`)
        .set('Authorization', `Bearer ${key}`)
        .send({ name: 'Should fail' })
        .expect(403)
    })

    it('read:User → 403 (disjoint subject)', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'UserReader', ['read:User'])

      await request(app.getHttpServer())
        .patch(`/organizations/${organizationId}`)
        .set('Authorization', `Bearer ${key}`)
        .send({ name: 'Should fail' })
        .expect(403)
    })

    it('read:all → 403 (wildcard scope: subject opens up, action stays read)', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'AllReader', ['read:all'])

      await request(app.getHttpServer())
        .patch(`/organizations/${organizationId}`)
        .set('Authorization', `Bearer ${key}`)
        .send({ name: 'Should fail' })
        .expect(403)
    })

    // Locks Stage 4's defense-in-depth at runtime: manage:all is dropped
    // at the applyScopes parse step until AK-05 scope registry rejects it
    // at the schema layer.
    it('manage:all → 403 (scope dropped until AK-05)', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'BadScope', ['manage:all'])

      await request(app.getHttpServer())
        .patch(`/organizations/${organizationId}`)
        .set('Authorization', `Bearer ${key}`)
        .send({ name: 'Should fail' })
        .expect(403)
    })
  })
})
