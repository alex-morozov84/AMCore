import { createHash, randomBytes } from 'node:crypto'

import { OrgAclVersionService } from '../src/core/auth/org-acl-version.service'
import { EnvService } from '../src/env/env.service'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { aclFailureCases } from './org-acl-failures'
import { type AclFixture, aclFixture, deferredGate } from './org-acl-freshness.fixture'
import { snapshotBarrier } from './org-acl-snapshot-barrier'

describe('Organization ACL freshness (real Postgres/Redis)', () => {
  let context: E2ETestContext
  let f: AclFixture
  const restore: (() => void)[] = []
  beforeAll(async () => {
    context = await setupE2ETest()
    await seedSystemRoles(context.prisma)
  }, 120000)
  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    f = await aclFixture(context)
  })
  afterEach(() => {
    while (restore.length) restore.pop()!()
  })

  aclFailureCases(() => f)

  it('grants/removes roles and permission links, then deletes a custom role with the same JWT', async () => {
    await f.member()
    await f.read().expect(403)
    const initial = await f.version()
    expect(await f.redis.get(f.key(initial))).toBe('[]')
    await f.assign()
    expect(await f.version()).toBe(initial + 1)
    await f.read().expect(403)
    const permission = await f.grant()
    expect(await f.version()).toBe(initial + 2)
    await f.read().expect(200)
    await f.http('delete', `${f.base}/roles/${f.role.id}/permissions/${permission.id}`).expect(204)
    expect(await f.version()).toBe(initial + 3)
    await f.read().expect(403)
    await f.grant()
    await f.read().expect(200)
    await f.remove()
    await f.read().expect(403)
    await f.assign()
    await f.read().expect(200)
    const beforeDelete = await f.version()
    await f.http('delete', `${f.base}/roles/${f.role.id}`).expect(204)
    expect(await f.version()).toBe(beforeDelete + 1)
    await f.read().expect(403)
  })

  it.each([0, 5000])(
    'ignores restored and corrupt legacy versions with deprecated TTL=%s',
    async (ttl) => {
      const env = context.app.get(EnvService)
      const get = env.get.bind(env)
      env.get = ((name) => (name === 'RBAC_ACLV_CACHE_TTL_MS' ? ttl : get(name))) as typeof env.get
      restore.push(() => {
        env.get = get
      })
      await f.member()
      await f.grant()
      await f.assign()
      await f.read().expect(200)
      const old = await f.version()
      const legacy = `auth:org:aclv:v1:${f.org.id}`
      await f.redis.del(legacy)
      const delayed = await f.prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })
      await f.remove()
      await f.redis.del(legacy)
      await f.redis.set(legacy, String(delayed.aclVersion))
      expect(await f.redis.get(legacy)).toBe(String(old))
      await f.read().expect(403)
      await f.redis.set(legacy, 'corrupt')
      await f.read().expect(403)
    }
  )

  it('V1: a paused old DB reader cannot restore authority for a subsequent request', async () => {
    await f.member()
    await f.grant()
    await f.assign()
    await f.read().expect(200)
    const old = await f.version()
    const gate = deferredGate()
    const get = f.prisma.organization.findUnique.bind(f.prisma.organization)
    let armed = true
    f.prisma.organization.findUnique = (async (args: Parameters<typeof get>[0]) => {
      const result = await get(args)
      if (armed && args.where.id === f.org.id && args.select?.aclVersion) {
        armed = false
        await gate.pause()
      }
      return result
    }) as unknown as typeof get
    restore.push(() => {
      f.prisma.organization.findUnique = get
    })
    const reader = f.read().then((res) => res.status)
    try {
      await gate.reached
      await f.remove()
      expect(await f.version()).toBe(old + 1)
    } finally {
      gate.release()
      await reader
    }
    await f.read().expect(403)
  })

  it('S1: permission-only RR snapshot cannot combine removed role with later grants', async () => {
    await f.member()
    await f.grant()
    await f.assign()
    await f.http('get', `${f.base}/roles`).expect(200)
    const old = await f.version()
    await f.redis.del(f.key(old))
    const barrier = snapshotBarrier(f.prisma)
    const reader = f.permissions.getPermissions(f.target.id, f.org.id, old)
    try {
      await barrier.reached
      await f.remove()
      await f
        .http('post', `${f.base}/roles/${f.role.id}/permissions`)
        .send({ action: 'delete', subject: 'User' })
        .expect(201)
      barrier.release()
      const rules = await reader
      expect(barrier.getIsolation()).toBe('repeatable read')
      expect(rules.some((p) => p.action === 'manage')).toBe(true)
      expect(rules.some((p) => p.action === 'delete' && p.subject === 'User')).toBe(false)
      expect(barrier.sql.some((sql) => /org_members/.test(sql))).toBe(true)
      expect(barrier.sql.some((sql) => /COMMIT/.test(sql))).toBe(true)
    } finally {
      barrier.release()
      await reader.catch(() => undefined)
      barrier.restore()
    }
    await f.read().expect(403)
  })

  it('S2: a delayed Redis fill after commit stays under the old selection fence', async () => {
    await f.member()
    await f.grant()
    await f.assign()
    const old = await f.version()
    const gate = deferredGate()
    const set = f.redis.set.bind(f.redis)
    let armed = true
    Object.assign(f.redis, {
      set: (async (...args: Parameters<typeof set>) => {
        if (armed && args[0] === f.key(old)) {
          armed = false
          await gate.pause()
        }
        return set(...args)
      }) as typeof set,
    })
    const reader = f.permissions.getPermissions(f.target.id, f.org.id, old)
    try {
      await gate.reached
      await f.remove()
    } finally {
      gate.release()
      try {
        await reader
      } finally {
        Object.assign(f.redis, { set })
      }
    }
    expect(await f.redis.get(f.key(old))).not.toBeNull()
    await f.read().expect(403)
  })

  it('removes membership and defeats warm cache after organization deletion', async () => {
    await f.member()
    await f.grant()
    await f.assign()
    await f.read().expect(200)
    const v = await f.version()
    await f.http('delete', `${f.base}/members/${f.target.id}`).expect(204)
    expect(await f.version()).toBe(v + 1)
    await f.read().expect(403)
    await f.http('delete', f.base).expect(204)
    await f.read().expect(404)
  })

  it('actual invitation acceptance/rejoin invalidates cached empty permissions', async () => {
    await f.grant()
    for (let round = 0; round < 2; round++) {
      const v = await f.version()
      await expect(f.permissions.getPermissions(f.target.id, f.org.id, v)).resolves.toEqual([])
      expect(await f.redis.get(f.key(v))).toBe('[]')
      const raw = randomBytes(32).toString('base64url')
      await f.prisma.orgInvite.create({
        data: {
          organizationId: f.org.id,
          email: f.target.email,
          emailCanonical: f.target.emailCanonical,
          roleId: f.role.id,
          invitedById: f.admin.id,
          tokenHash: createHash('sha256').update(raw).digest('hex'),
          expiresAt: new Date(Date.now() + 60000),
        },
      })
      await f
        .http('post', '/auth/invites/accept', f.token(f.target))
        .send({ token: raw })
        .expect(200)
      expect(await f.version()).toBe(v + 1)
      await f.read().expect(200)
      await f.http('delete', `${f.base}/members/${f.target.id}`).expect(204)
    }
  })

  it('uses shared primary authority across instances despite failed legacy invalidation', async () => {
    await f.member()
    await f.grant()
    await f.assign()
    await f.read().expect(200)
    const old = await f.version()
    const second = new OrgAclVersionService(f.prisma)
    const legacy = `auth:org:aclv:v1:${f.org.id}`
    await f.redis.set(legacy, String(old))
    // Removing legacy DEL no longer depends on Redis publication succeeding.
    await f.remove()
    expect(await f.versions.getCurrent(f.org.id)).toBe(old + 1)
    expect(await second.getCurrent(f.org.id)).toBe(old + 1)
    expect(await f.redis.get(legacy)).toBe(String(old))
    await f.read().expect(403)
  })

  it('API keys keep current membership/version admission and intersect owner rights', async () => {
    await f.member()
    await f.grant()
    await f.assign()
    const created = await f
      .http('post', '/api-keys', f.targetToken)
      .send({
        name: 'Fixture scoped key',
        organizationId: f.org.id,
        scopes: ['manage:Organization'],
      })
      .expect(201)
    expect(created.body.key).toEqual(expect.any(String))
    const key = created.body.key as string
    await f.http('get', `${f.base}/roles`, key).expect(200)
    await f.remove()
    await f.http('get', `${f.base}/roles`, key).expect(403)
    await f.assign()
    await f.http('get', `${f.base}/roles`, key).expect(200)
    await f.http('delete', `${f.base}/members/${f.target.id}`).expect(204)
    await f.http('get', `${f.base}/roles`, key).expect(401)
  })

  it('actual permission-lock contention loads a coherent snapshot after five misses', async () => {
    await f.member()
    await f.grant()
    await f.assign()
    const v = await f.version()
    const lockKey = `auth:lock:perm:v2:${f.org.id}:${f.target.id}`
    await f.redis.set(lockKey, 'another-holder')
    try {
      const rules = await f.permissions.getPermissions(f.target.id, f.org.id, v)
      expect(rules.some((p) => p.action === 'manage')).toBe(true)
      expect(await f.redis.get(lockKey)).toBe('another-holder')
      expect(await f.redis.get(f.key(v))).not.toBeNull()
    } finally {
      await f.redis.del(lockKey)
    }
  })

  it('corrupt permission data refills coherently and version zero remains valid', async () => {
    expect(await f.version()).toBe(0)
    await f.member()
    await f.grant()
    await f.assign()
    const v = await f.version()
    for (const corrupt of ['{broken', '42']) {
      await f.redis.set(f.key(v), corrupt)
      await f.read().expect(200)
      expect(JSON.parse((await f.redis.get(f.key(v)))!)).toEqual(expect.any(Array))
    }
  })
})
