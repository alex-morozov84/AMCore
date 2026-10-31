import { jest } from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { ApiKeysService } from '../src/core/api-keys/api-keys.service'
import type { Prisma } from '../src/generated/prisma/client'
import {
  AbuseCounterError,
  AbuseCounterStore,
  AuthRedis,
  BOUNDED_REDIS_CAPACITY,
} from '../src/infrastructure/redis'
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

  describe('own-key search and organization metadata', () => {
    it('combines literal name, organization and status with owner-scoped counts', async () => {
      const actor = await registerWithOrg('search@example.test', 'First', 'search-first')
      const second = await createOrganization(actor.token, 'Second', 'search-second')
      const foreign = await registerWithOrg('foreign@example.test', 'Foreign', 'search-foreign')
      const firstKey = await createApiKey(actor.token, actor.organizationId, 'Отчёт_%\\ Exact')
      await createApiKey(actor.token, actor.organizationId, 'Отчёт wildcard')
      await createApiKey(actor.token, second, 'Отчёт_%\\ Exact')
      await createApiKey(foreign.token, foreign.organizationId, 'Отчёт_%\\ Exact')
      const list = (q: Record<string, string | number>) =>
        request(app.getHttpServer()).get('/api-keys').auth(actor.token, { type: 'bearer' }).query(q)
      const result = await list({
        search: '  ОТЧЁТ_%\\  ',
        organizationId: actor.organizationId,
        status: 'unexpired',
        limit: 1,
      }).expect(200)
      expect(result.body.total).toBe(1)
      expect(result.body.data.map((k: { id: string }) => k.id)).toEqual([firstKey.id])
      await list({
        organizationId: actor.organizationId,
        organizationAvailability: 'unavailable',
      }).expect(400)
      await list({ page: Number.MAX_SAFE_INTEGER, limit: 100 }).expect(400)
      await request(app.getHttpServer())
        .get('/api-keys?search=a&search=b')
        .auth(actor.token, { type: 'bearer' })
        .expect(400)
      await prisma.orgMember.deleteMany({ where: { userId: actor.userId, organizationId: second } })
      const unavailable = await list({ organizationAvailability: 'unavailable' }).expect(200)
      expect(unavailable.body.total).toBe(1)
      expect(unavailable.body.data[0].organizationName).toBeNull()
    })

    it('bounds purpose-specific options, pins selected outside search and never exposes former names', async () => {
      const actor = await registerWithOrg('facets@example.test', 'Same name', 'facets-one')
      const noKeys = await createOrganization(actor.token, 'No keys', 'facets-no-keys')
      const former = await createOrganization(actor.token, 'Private former name', 'facets-former')
      const reader = await registerAndGetToken('facet-reader@example.test')
      const role = await prisma.role.findFirstOrThrow({ where: { name: 'MEMBER', isSystem: true } })
      await seedOrgMember(prisma, {
        orgId: actor.organizationId,
        userId: reader.userId,
        roleId: role.id,
      })
      await createApiKey(actor.token, actor.organizationId)
      await createApiKey(actor.token, former)
      await prisma.orgMember.deleteMany({ where: { userId: actor.userId, organizationId: former } })
      const options = (token: string, q: Record<string, string | number>) =>
        request(app.getHttpServer())
          .get('/api-keys/organizations')
          .auth(token, { type: 'bearer' })
          .query(q)
      const inventory = await options(actor.token, {
        purpose: 'inventory',
        search: 'not matched',
        selectedId: actor.organizationId,
      }).expect(200)
      expect(inventory.body).toMatchObject({
        total: 0,
        data: [],
        hasUnavailable: true,
        selected: { id: actor.organizationId },
      })
      expect(inventory.body.selected).not.toHaveProperty('canManageTeamAccess')
      expect(JSON.stringify(inventory.body)).not.toContain('Private former name')
      const creation = await options(actor.token, {
        purpose: 'creation',
        selectedId: noKeys,
      }).expect(200)
      expect(creation.body.total).toBe(2)
      expect(creation.body.selected).toMatchObject({ id: noKeys, canManageTeamAccess: true })
      const member = await options(reader.token, { purpose: 'creation' }).expect(200)
      expect(member.body.data[0].canManageTeamAccess).toBe(false)
      const hidden = await options(reader.token, {
        purpose: 'inventory',
        selectedId: noKeys,
      }).expect(200)
      expect(hidden.body.selected).toBeNull()
      await options(actor.token, { purpose: 'creation', limit: 21 }).expect(400)
      await options(actor.token, { purpose: 'creation', unknown: 'x' }).expect(400)
    })
  })

  describe('personal issuance and catalogue runtime requirements', () => {
    it('allows a distinct noncreator MEMBER to issue only their own key', async () => {
      const admin = await registerWithOrg('admin@example.test')
      const member = await registerAndGetToken('member@example.test')
      const role = await prisma.role.findFirstOrThrow({ where: { name: 'MEMBER', isSystem: true } })
      const { memberId } = await seedOrgMember(prisma, {
        orgId: admin.organizationId,
        userId: member.userId,
        roleId: role.id,
      })
      const assignments = await prisma.memberRole.findMany({
        where: { memberId },
        include: { role: true },
      })
      expect(assignments.map((link) => link.role.name)).toEqual(['MEMBER'])
      const context = await request(app.getHttpServer())
        .get(`/organizations/${admin.organizationId}/context`)
        .auth(member.token, { type: 'bearer' })
        .expect(200)
      expect(context.body.canManageTeamAccess).toBe(false)
      const key = await createApiKey(member.token, admin.organizationId, 'Own export', [
        'read:Organization',
      ])
      expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).userId).toBe(
        member.userId
      )
      await request(app.getHttpServer())
        .delete(`/api-keys/${key.id}`)
        .auth(admin.token, { type: 'bearer' })
        .expect(404)
    })

    it('keeps owner-wide cleanup but conceals the current name of a former organization', async () => {
      const admin = await registerWithOrg('admin@example.test', 'Former organization')
      const member = await registerAndGetToken('member@example.test')
      const role = await prisma.role.findFirstOrThrow({ where: { name: 'MEMBER', isSystem: true } })
      const { memberId } = await seedOrgMember(prisma, {
        orgId: admin.organizationId,
        userId: member.userId,
        roleId: role.id,
      })
      const oldKey = await createApiKey(member.token, admin.organizationId)
      const currentOrg = await createOrganization(member.token, 'Current organization')
      const currentKey = await createApiKey(member.token, currentOrg)
      await request(app.getHttpServer())
        .delete(
          `/organizations/${admin.organizationId}/members/${member.userId}?expectedMemberId=${memberId}`
        )
        .auth(admin.token, { type: 'bearer' })
        .expect(204)
      await request(app.getHttpServer())
        .patch(`/organizations/${admin.organizationId}`)
        .auth(admin.token, { type: 'bearer' })
        .send({ name: 'Private new name' })
        .expect(200)
      const list = await request(app.getHttpServer())
        .get('/api-keys?status=all&limit=1&page=1')
        .auth(member.token, { type: 'bearer' })
        .expect(200)
      expect(list.body.total).toBe(2)
      expect(list.body.data).toHaveLength(1)
      const all = await request(app.getHttpServer())
        .get('/api-keys')
        .auth(member.token, { type: 'bearer' })
        .expect(200)
      expect(all.body.data.find((key: { id: string }) => key.id === oldKey.id)).toMatchObject({
        organizationName: null,
        status: 'revoked',
        revocationReason: 'membership_removed',
      })
      expect(all.body.data.find((key: { id: string }) => key.id === currentKey.id)).toMatchObject({
        organizationName: 'Current organization',
        status: 'unexpired',
      })
      expect(JSON.stringify(all.body)).not.toContain('Private new name')
      await request(app.getHttpServer())
        .delete(`/api-keys/${oldKey.id}`)
        .auth(member.token, { type: 'bearer' })
        .expect(204)
    })

    it('keeps page and count in one real snapshot during a controlled concurrent creation', async () => {
      const owner = await registerWithOrg('snapshot@example.test')
      const first = await createApiKey(owner.token, owner.organizationId, 'Before snapshot')
      let pageRead!: () => void
      let allowCount!: () => void
      const pageReady = new Promise<void>((resolve) => {
        pageRead = resolve
      })
      const countGate = new Promise<void>((resolve) => {
        allowCount = resolve
      })
      const transaction = prisma.$transaction.bind(prisma)
      type Work = (tx: Prisma.TransactionClient) => Promise<unknown>
      // Gate only the owner-list transaction. Real SQL uses the service's supplied isolation level.
      const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (
        work: Work,
        options: { isolationLevel: Prisma.TransactionIsolationLevel }
      ) =>
        transaction(async (tx) => {
          const apiKey = new Proxy(tx.apiKey, {
            get(target, property) {
              if (property === 'findMany')
                return async (args: Prisma.ApiKeyFindManyArgs) => {
                  const rows = await target.findMany(args)
                  pageRead()
                  return rows
                }
              if (property === 'count')
                return async (args: Prisma.ApiKeyCountArgs) => {
                  await countGate
                  return target.count(args)
                }
              return Reflect.get(target, property)
            },
          })
          return work(
            new Proxy(tx, {
              get(target, property) {
                return property === 'apiKey' ? apiKey : Reflect.get(target, property)
              },
            })
          )
        }, options)) as never)
      const reading = app.get(ApiKeysService).findAllForUser(owner.userId, 1, 20)
      spy.mockRestore()
      try {
        await pageReady
        await createApiKey(owner.token, owner.organizationId, 'After snapshot')
      } finally {
        allowCount()
      }
      const snapshot = await reading
      expect(snapshot.total).toBe(1)
      expect(snapshot.data.map((key) => key.id)).toEqual([first.id])
      expect(
        (
          await request(app.getHttpServer())
            .get('/api-keys')
            .auth(owner.token, { type: 'bearer' })
            .expect(200)
        ).body.total
      ).toBe(2)
    })

    it('DELETE requires delete and full TeamAccess, but no read scope', async () => {
      const owner = await registerWithOrg('owner@example.test')
      for (const scopes of [['delete:Organization'], ['manage:TeamAccess']]) {
        const key = await createApiKey(owner.token, owner.organizationId, 'Incomplete', scopes)
        await request(app.getHttpServer())
          .delete(`/organizations/${owner.organizationId}`)
          .auth(key.key, { type: 'bearer' })
          .expect(403)
      }
      const key = await createApiKey(owner.token, owner.organizationId, 'Complete', [
        'delete:Organization',
        'manage:TeamAccess',
      ])
      await request(app.getHttpServer())
        .delete(`/organizations/${owner.organizationId}`)
        .auth(key.key, { type: 'bearer' })
        .expect(204)
    })

    it('PATCH requires a response-read scope in addition to update', async () => {
      const owner = await registerWithOrg('owner@example.test')
      const incomplete = await createApiKey(owner.token, owner.organizationId, 'Incomplete', [
        'update:Organization',
      ])
      await request(app.getHttpServer())
        .patch(`/organizations/${owner.organizationId}`)
        .auth(incomplete.key, { type: 'bearer' })
        .send({ name: 'Changed' })
        .expect(403)
      const complete = await createApiKey(owner.token, owner.organizationId, 'Complete', [
        'update:Organization',
        'read:Organization',
      ])
      await request(app.getHttpServer())
        .patch(`/organizations/${owner.organizationId}`)
        .auth(complete.key, { type: 'bearer' })
        .send({ name: 'Changed' })
        .expect(200)
    })
  })

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
    it('lists keys without secret fields in paginated envelope (OB-05)', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      await createApiKey(token, organizationId, 'Key One', ['read:User'])
      await createApiKey(token, organizationId, 'Key Two', ['read:User'])

      const res = await request(app.getHttpServer())
        .get('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(res.body.total).toBe(2)
      expect(res.body.page).toBe(1)
      expect(res.body.limit).toBe(20)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(2)
      expect(res.body.data[0]).not.toHaveProperty('key')
      expect(res.body.data[0]).not.toHaveProperty('keyHash')
      expect(res.body.data[0]).not.toHaveProperty('salt')
      expect(res.body.data[0]).toHaveProperty('id')
      expect(res.body.data[0]).toHaveProperty('name')
      expect(res.body.data[0]).toHaveProperty('organizationId')
      expect(res.body.data[0]).toHaveProperty('scopes')
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

  describe('AK-07: failure counters', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('answers 503 SERVICE_UNAVAILABLE and does no verification work when the counters cannot be read', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'CI Key', ['read:User'])
      jest
        .spyOn(app.get(AbuseCounterStore), 'read')
        .mockRejectedValueOnce(new AbuseCounterError('unavailable', 'unknown'))
      const verify = jest.spyOn(app.get(ApiKeysService), 'verifyByShortToken')

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${key}`)

      expect(res.status).toBe(503)
      expect(res.body.errorCode).toBe('SERVICE_UNAVAILABLE')
      expect(verify).not.toHaveBeenCalled()
    })

    it('keeps a verified key working when clearing its fingerprint counter fails', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'CI Key', ['read:User'])
      jest
        .spyOn(app.get(AbuseCounterStore), 'clear')
        .mockRejectedValueOnce(new AbuseCounterError('unavailable', 'unknown'))

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${key}`)

      expect(res.status).toBe(200)
    })

    it.each(['not_sent', 'unknown'] as const)(
      'answers 503 when a failed verification cannot be recorded (%s), without authenticating',
      async (outcome) => {
        jest
          .spyOn(app.get(AbuseCounterStore), 'increment')
          .mockRejectedValueOnce(new AbuseCounterError('unavailable', outcome))

        const res = await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer amcore_live_${'a'.repeat(11)}_${'b'.repeat(32)}`)

        expect(res.status).toBe(503)
        expect(res.body.errorCode).toBe('SERVICE_UNAVAILABLE')
        expect(res.body.user).toBeUndefined()
      }
    )

    it('answers 503 when the counters are unreadable because the helper is at capacity', async () => {
      const bounded = app.get(AuthRedis)
      const held: Array<() => void> = []
      for (let i = 0; i < BOUNDED_REDIS_CAPACITY; i++)
        void bounded
          .run(() => new Promise<void>((resolve) => held.push(resolve)), 60_000)
          .catch(() => undefined)
      const verify = jest.spyOn(app.get(ApiKeysService), 'verifyByShortToken')

      try {
        const res = await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer amcore_live_${'e'.repeat(11)}_${'f'.repeat(32)}`)

        expect(res.status).toBe(503)
        expect(res.body.errorCode).toBe('SERVICE_UNAVAILABLE')
        expect(verify).not.toHaveBeenCalled()
      } finally {
        for (const release of held) release()
        await new Promise((resolve) => setImmediate(resolve))
      }
    })

    it('counts bad keys atomically in v2 integer keys and clears only the fingerprint on success', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')
      const { key } = await createApiKey(token, organizationId, 'CI Key', ['read:User'])
      const bad = `amcore_live_${'c'.repeat(11)}_${'d'.repeat(32)}`

      await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${bad}`)
        )
      ).then((all) => all.forEach((res) => expect(res.status).toBe(401)))
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${key}`)
        .expect(200)

      const redis = context.cache.connection
      const [ipKey] = await redis.keys('rate:v2:api_key_fail_ip:*')
      expect(await redis.get(ipKey!)).toBe('5')
      expect((await redis.keys('rate:v2:api_key_fail_token:*')).length).toBe(1)
      expect(await redis.keys('rate:api_key_fail_*')).toEqual([])
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

      // Target key still exists and authenticates (OB-05 envelope).
      await request(app.getHttpServer())
        .get('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .then((res) => {
          const body = res.body as { data: Array<{ id: string }> }
          expect(body.data.some((k) => k.id === targetId)).toBe(true)
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
   * AK-05: scope validation rejects invalid input at the schema layer.
   *
   * Before AK-05, `scopes` was `z.array(z.string()).min(1)` — any string
   * was accepted, including non-canonical formats like `user:read`,
   * unknown actions/subjects, and `manage:all`. The result was a silent
   * failure: 201 on create, then 403 on every authorized request with no
   * diagnostic. This block proves that the schema now rejects each
   * failure mode at the 400 layer with a machine-readable error code in
   * `errors[].errorCode`.
   */
  describe('AK-05: scope validation rejects invalid input', () => {
    const postWithScopes = (token: string, organizationId: string, scopes: string[]) =>
      request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Invalid scope test', organizationId, scopes })

    it('rejects manage:all → 400 + API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')

      const res = await postWithScopes(token, organizationId, ['manage:all']).expect(400)
      const fieldErrors = res.body.errors as Array<{ field: string; errorCode?: string }>
      expect(fieldErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'scopes.0',
            errorCode: 'API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN',
          }),
        ])
      )
    })

    it('rejects unknown subject read:NonExistent → 400 + API_KEY_SCOPE_UNKNOWN_SUBJECT', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')

      const res = await postWithScopes(token, organizationId, ['read:NonExistent']).expect(400)
      const fieldErrors = res.body.errors as Array<{ field: string; errorCode?: string }>
      expect(fieldErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'scopes.0',
            errorCode: 'API_KEY_SCOPE_UNKNOWN_SUBJECT',
          }),
        ])
      )
    })

    it('rejects unknown action user:read (old format) → 400 + API_KEY_SCOPE_UNKNOWN_ACTION', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')

      const res = await postWithScopes(token, organizationId, ['user:read']).expect(400)
      const fieldErrors = res.body.errors as Array<{ field: string; errorCode?: string }>
      expect(fieldErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'scopes.0',
            errorCode: 'API_KEY_SCOPE_UNKNOWN_ACTION',
          }),
        ])
      )
    })

    it('mixed valid + invalid: error appears at scopes.1, not scopes.0', async () => {
      const { token, organizationId } = await registerWithOrg('user@example.com')

      const res = await postWithScopes(token, organizationId, ['read:User', 'manage:all']).expect(
        400
      )
      const fieldErrors = res.body.errors as Array<{ field: string; errorCode?: string }>
      const badIndex = fieldErrors.find((e) => e.field === 'scopes.1')
      const goodIndex = fieldErrors.find((e) => e.field === 'scopes.0')
      expect(badIndex?.errorCode).toBe('API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN')
      expect(goodIndex).toBeUndefined()
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
    it('an operator-owned key keeps explicit org grants but loses access when those grants are removed', async () => {
      const { token, userId, organizationId } = await registerWithOrg('operator-key@example.test')
      const { key } = await createApiKey(token, organizationId, 'Operator integration', [
        'manage:Organization',
      ])
      await prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })
      await request(app.getHttpServer())
        .patch(`/organizations/${organizationId}`)
        .auth(key, { type: 'bearer' })
        .send({ name: 'Explicit organization grant' })
        .expect(200)
      await prisma.$transaction(async (tx) => {
        const member = await tx.orgMember.findUniqueOrThrow({
          where: { userId_organizationId: { userId, organizationId } },
        })
        await tx.memberRole.deleteMany({ where: { memberId: member.id } })
        await tx.organization.update({
          where: { id: organizationId },
          data: { aclVersion: { increment: 1 } },
        })
      })
      await request(app.getHttpServer())
        .patch(`/organizations/${organizationId}`)
        .auth(key, { type: 'bearer' })
        .send({ name: 'Must stay unchanged' })
        .expect(403)
      expect(
        (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).name
      ).toBe('Explicit organization grant')
      await request(app.getHttpServer())
        .get('/admin/access')
        .auth(key, { type: 'bearer' })
        .expect(401)
    })

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

    // Note: the original Stage 5 `manage:all → 403` case was removed in
    // Stage 6 / AK-05. The schema now rejects `manage:all` at POST /api-keys
    // with `API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN`, so the create-then-deny
    // flow is no longer reachable from the API. Stage 4's defense-in-depth
    // drop in `applyScopes` is still exercised by unit tests in
    // `ability.factory.spec.ts`. The "scope rejected at schema" case
    // lives in the AK-05 describe block above.
  })
})
