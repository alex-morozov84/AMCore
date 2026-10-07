import { createHash, randomBytes } from 'node:crypto'

import { JwtService } from '@nestjs/jwt'
import { Pool } from 'pg'
import request from 'supertest'

import { AuditLogService } from '../src/core/audit'
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
const jest = import.meta.jest

describe('Role definitions: list, detail, atomic save, confirmed delete (real DB)', () => {
  let context: E2ETestContext
  let prisma: PrismaService
  let pool: Pool
  let token: string
  let orgId: string
  let ownerId: string

  beforeAll(async () => {
    context = await setupE2ETest()
    prisma = context.prisma
    await seedSystemRoles(prisma)
    pool = new Pool({ connectionString: context.postgresContainer.getConnectionUri() })
  }, 120000)
  afterAll(async () => {
    await pool?.end()
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    const owner = await register('owner@example.test')
    token = owner.accessToken
    ownerId = context.app.get(JwtService).verify(token).sub
    const org = await request(context.app.getHttpServer())
      .post('/organizations')
      .auth(token, { type: 'bearer' })
      .send({ name: 'Role lab' })
      .expect(201)
    orgId = org.body.id
  })

  const http = () => request(context.app.getHttpServer())
  async function register(email: string) {
    return (
      await http().post('/auth/register').send({ email, password: 'StrongP@ss123' }).expect(201)
    ).body as { accessToken: string }
  }
  const base = () => `/organizations/${orgId}/role-definitions`
  const get = (path = '', bearer = token) =>
    http().get(`${base()}${path}`).auth(bearer, { type: 'bearer' })
  const create = (body: object) => http().post(base()).auth(token, { type: 'bearer' }).send(body)
  const save = (roleId: string, body: object) =>
    http().patch(`${base()}/${roleId}`).auth(token, { type: 'bearer' }).send(body)
  const remove = (roleId: string, body: object) =>
    http().post(`${base()}/${roleId}/deletion`).auth(token, { type: 'bearer' }).send(body)

  async function newRole(name = 'Sales') {
    return (await create({ name }).expect(201)).body
  }
  const definition = (
    detail: { role: { name: string; description: string | null }; aclVersion: number },
    over: object = {}
  ) => ({
    expectedAclVersion: detail.aclVersion,
    name: detail.role.name,
    description: detail.role.description,
    presets: [],
    ...over,
  })
  async function revision(): Promise<number> {
    return (await pool.query('SELECT "aclVersion" FROM core.organizations WHERE id=$1', [orgId]))
      .rows[0].aclVersion
  }
  async function auditRows(action: string) {
    return (
      await pool.query(
        `SELECT * FROM core.audit_log WHERE action=$1 AND "organizationId"=$2 ORDER BY "createdAt"`,
        [action, orgId]
      )
    ).rows
  }
  async function permissionCount() {
    return (
      await pool.query(
        'SELECT count(*)::int AS n FROM core.permissions WHERE "organizationId"=$1',
        [orgId]
      )
    ).rows[0].n as number
  }

  it('lists builtin templates with organization-local holder counts and searches literally', async () => {
    const other = await register('other@example.test')
    await http()
      .post('/organizations')
      .auth(other.accessToken, { type: 'bearer' })
      .send({ name: 'Other org' })
      .expect(201)
    await newRole('Sales team')
    const list = await get().expect(200)
    const admin = list.body.data.find((r: { name: string }) => r.name === 'ADMIN')
    expect(admin).toMatchObject({ isSystem: true, holderCount: 1, grantsFullControl: true })
    // The other organization's ADMIN does not leak into this organization's count.
    const sales = await get('?search=sales%20team').expect(200)
    expect(sales.body.data.map((r: { name: string }) => r.name)).toEqual(['Sales team'])
    expect(sales.body.data[0]).toMatchObject({
      holderCount: 0,
      ruleCount: 0,
      advancedState: 'none',
    })
    await get('?search=%25')
      .expect(200)
      .then((res) => expect(res.body.total).toBe(0))
  })

  it('creates an empty role: 201, revision bump, one audit row, reserved and colliding names rejected', async () => {
    const before = await revision()
    const detail = (
      await create({ name: '  Support lead  ', description: '  Handles escalations ' }).expect(201)
    ).body
    expect(detail.role).toMatchObject({ name: 'Support lead', description: 'Handles escalations' })
    expect(detail).toMatchObject({ editMode: 'editable', selfHeld: false, ruleCount: 0 })
    expect(detail.aclVersion).toBe(before + 1)
    expect(await revision()).toBe(before + 1)
    const rows = await auditRows('org.role_created')
    expect(rows).toHaveLength(1)
    expect(rows[0].metadata).toMatchObject({ roleId: detail.role.id, actorCredentialType: 'jwt' })
    expect(JSON.stringify(rows[0].metadata)).not.toContain('Support lead')
    await create({ name: 'admin' })
      .expect(400)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_NAME_RESERVED'))
    await create({ name: 'SUPPORT LEAD' })
      .expect(409)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_NAME_CONFLICT'))
    await create({ name: 'x' }).expect(400)
    await create({ name: 'Valid', extra: true }).expect(400)
  })

  it('saves managed presets atomically, preserves advanced rules, and no-ops without bump or audit', async () => {
    const role = await newRole()
    // An advanced DENY rule added through the legacy route is preserved verbatim.
    const advanced = await http()
      .post(`/organizations/${orgId}/roles/${role.role.id}/permissions`)
      .auth(token, { type: 'bearer' })
      .send({
        action: 'read',
        subject: 'User',
        conditions: { id: 'someone' },
        fields: ['name'],
        inverted: true,
      })
      .expect(201)
    const fresh = (await get(`/${role.role.id}`).expect(200)).body
    expect(fresh.advancedRules).toHaveLength(1)
    const saved = await save(
      role.role.id,
      definition(fresh, {
        presets: [
          { capabilityId: 'organization.read', presetId: 'own' },
          { capabilityId: 'organization.update', presetId: 'own' },
        ],
      })
    ).expect(200)
    expect(saved.body.changed).toBe(true)
    expect(
      saved.body.detail.managedPresets.map((p: { capabilityId: string }) => p.capabilityId)
    ).toEqual(['organization.read', 'organization.update'])
    expect(saved.body.detail.advancedRules[0].permissionId).toBe(advanced.body.id)
    expect(saved.body.detail.aclVersion).toBe(fresh.aclVersion + 1)
    // The legacy rule route used during setup and the definition save are each audited once.
    const events = await auditRows('org.role_updated')
    expect(events.map((row) => row.metadata.source)).toEqual(['legacy', 'editor'])

    const settled = saved.body.detail
    const rev = await revision()
    const audits = (await auditRows('org.role_updated')).length
    const noop = await save(
      role.role.id,
      definition(settled, {
        presets: [
          { capabilityId: 'organization.read', presetId: 'own' },
          { capabilityId: 'organization.update', presetId: 'own' },
        ],
      })
    ).expect(200)
    expect(noop.body.changed).toBe(false)
    expect(await revision()).toBe(rev)
    expect(await auditRows('org.role_updated')).toHaveLength(audits)
    // Unchanged managed rows keep their permission ids.
    expect(
      noop.body.detail.managedPresets.map((p: { permissionIds: string[] }) => p.permissionIds)
    ).toEqual(settled.managedPresets.map((p: { permissionIds: string[] }) => p.permissionIds))
  })

  it('rejects stale revisions, unknown presets, system and foreign roles with stable codes', async () => {
    const role = await newRole()
    const first = (await get(`/${role.role.id}`).expect(200)).body
    await save(role.role.id, definition(first, { name: 'Sales 2' })).expect(200)
    await save(role.role.id, definition(first, { name: 'Sales 3' }))
      .expect(409)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT'))
    const current = (await get(`/${role.role.id}`).expect(200)).body
    await save(
      role.role.id,
      definition(current, {
        presets: [{ capabilityId: 'organization.read', presetId: 'assigned' }],
      })
    )
      .expect(400)
      .then((r) => expect(r.body.errorCode).toBe('CAPABILITY_UNSUPPORTED'))
    const admin = await prisma.role.findFirstOrThrow({ where: { name: 'ADMIN', isSystem: true } })
    await save(admin.id, definition(current))
      .expect(403)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_SYSTEM_IMMUTABLE'))
    await get(`/${admin.id}`)
      .expect(200)
      .then((r) => expect(r.body).toMatchObject({ editMode: 'system' }))
    await get('/does-not-exist')
      .expect(404)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_UNAVAILABLE'))
    await get('/bad%2Fid').expect(404)
    await save(role.role.id, {
      ...definition(current),
      presets: [
        { capabilityId: 'organization.read', presetId: 'own' },
        { capabilityId: 'organization.read', presetId: 'own' },
      ],
    }).expect(400)
  })

  it('requires explicit acknowledgments for full control and for changing a role you hold', async () => {
    const role = await newRole('Lead')
    const detail = (await get(`/${role.role.id}`).expect(200)).body
    const withFull = definition(detail, {
      presets: [{ capabilityId: 'teamAccess.manage', presetId: 'all' }],
    })
    await save(role.role.id, withFull)
      .expect(400)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_FULL_CONTROL_ACK_REQUIRED'))
    const done = await save(role.role.id, { ...withFull, acknowledgeFullControl: true }).expect(200)
    expect(done.body.detail.grantsFullControl).toBe(true)
    expect(await auditRows('org.role_updated').then((rows) => rows[0].metadata)).toMatchObject({
      fullControl: 'added',
    })
    // Give the owner the role, then changing its presets requires the self-held acknowledgment.
    const owner = await prisma.orgMember.findFirstOrThrow({
      where: { organizationId: orgId, userId: ownerId },
    })
    await prisma.memberRole.create({ data: { memberId: owner.id, roleId: role.role.id } })
    await prisma.organization.update({
      where: { id: orgId },
      data: { aclVersion: { increment: 1 } },
    })
    const held = (await get(`/${role.role.id}`).expect(200)).body
    expect(held.selfHeld).toBe(true)
    const removeFull = definition(held, { presets: [] })
    await save(role.role.id, removeFull)
      .expect(400)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_SELF_HELD_ACK_REQUIRED'))
    await save(role.role.id, { ...removeFull, acknowledgeSelfHeld: true }).expect(200)
  })

  it('preserves an unchanged raw legacy name and applies the new rules only to a real rename', async () => {
    const legacy = await prisma.role.create({
      data: { name: ' ADMIN ', organizationId: orgId, isSystem: false },
    })
    const detail = (await get(`/${legacy.id}`).expect(200)).body
    expect(detail.role.name).toBe(' ADMIN ')
    const saved = await save(
      legacy.id,
      definition(detail, { presets: [{ capabilityId: 'organization.read', presetId: 'all' }] })
    ).expect(200)
    expect(saved.body.detail.role.name).toBe(' ADMIN ')
    await save(legacy.id, definition(saved.body.detail, { name: 'MEMBER' }))
      .expect(400)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_NAME_RESERVED'))
    await save(legacy.id, definition(saved.body.detail, { name: '  Auditors ' }))
      .expect(200)
      .then((r) => expect(r.body.detail.role.name).toBe('Auditors'))
  })

  it('detaches only one role link of a shared permission and collects orphans', async () => {
    const a = await newRole('Role A')
    const b = await newRole('Role B')
    const first = (await get(`/${a.role.id}`).expect(200)).body
    const saved = (
      await save(
        a.role.id,
        definition(first, { presets: [{ capabilityId: 'organization.read', presetId: 'own' }] })
      ).expect(200)
    ).body
    const sharedId = saved.detail.managedPresets[0].permissionIds[0]
    await prisma.rolePermission.create({ data: { roleId: b.role.id, permissionId: sharedId } })
    await prisma.organization.update({
      where: { id: orgId },
      data: { aclVersion: { increment: 1 } },
    })
    const cur = (await get(`/${a.role.id}`).expect(200)).body
    await save(a.role.id, definition(cur, { presets: [] })).expect(200)
    // The shared row still serves role B.
    const rowB = await pool.query(
      'SELECT 1 FROM core.role_permissions WHERE "roleId"=$1 AND "permissionId"=$2',
      [b.role.id, sharedId]
    )
    expect(rowB.rowCount).toBe(1)
    const bCur = (await get(`/${b.role.id}`).expect(200)).body
    await save(b.role.id, definition(bCur, { presets: [] })).expect(200)
    // Now no role links the row: it is collected.
    expect(
      (await pool.query('SELECT 1 FROM core.permissions WHERE id=$1', [sharedId])).rowCount
    ).toBe(0)
  })

  it('legacy removal of a shared permission detaches only its own link', async () => {
    const a = await newRole('Legacy A')
    const b = await newRole('Legacy B')
    const perm = await http()
      .post(`/organizations/${orgId}/roles/${a.role.id}/permissions`)
      .auth(token, { type: 'bearer' })
      .send({ action: 'read', subject: 'User', conditions: { id: 'x' }, fields: [] })
      .expect(201)
    await prisma.rolePermission.create({ data: { roleId: b.role.id, permissionId: perm.body.id } })
    const rev = await revision()
    await http()
      .delete(`/organizations/${orgId}/roles/${a.role.id}/permissions/${perm.body.id}`)
      .auth(token, { type: 'bearer' })
      .expect(204)
    expect(await revision()).toBe(rev + 1)
    expect(
      (await pool.query('SELECT 1 FROM core.role_permissions WHERE "roleId"=$1', [b.role.id]))
        .rowCount
    ).toBe(1)
    expect(
      (await auditRows('org.role_updated')).some((row) => row.metadata.source === 'legacy')
    ).toBe(true)
  })

  it('rolls back the whole command when the strict in-transaction audit fails', async () => {
    const role = await newRole('Atomic')
    const detail = (await get(`/${role.role.id}`).expect(200)).body
    const rev = await revision()
    const spy = jest
      .spyOn(context.app.get(AuditLogService), 'record')
      .mockRejectedValueOnce(new Error('audit down'))
    await save(
      role.role.id,
      definition(detail, {
        name: 'Renamed',
        presets: [{ capabilityId: 'organization.read', presetId: 'own' }],
      })
    )
      .expect(503)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_SAVE_UNAVAILABLE'))
    spy.mockRestore()
    expect(await revision()).toBe(rev)
    expect((await prisma.role.findUniqueOrThrow({ where: { id: role.role.id } })).name).toBe(
      'Atomic'
    )
    expect(await permissionCount()).toBe(0)
  })

  it('serializes concurrent saves from one revision: exactly one wins, the other conflicts', async () => {
    const role = await newRole('Race')
    const detail = (await get(`/${role.role.id}`).expect(200)).body
    const results = await Promise.all([
      save(role.role.id, definition(detail, { name: 'Race one' })),
      save(role.role.id, definition(detail, { name: 'Race two' })),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(results.find((r) => r.status === 409)!.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT')
  })

  it('deletes with a confirmed holder and invitation impact; stale impact is refused', async () => {
    const role = await newRole('Doomed')
    const member = await register('member@example.test')
    const userId = context.app.get(JwtService).verify(member.accessToken).sub
    await seedOrgMember(prisma, { orgId, userId, roleId: role.role.id })
    await prisma.orgInvite.create({
      data: {
        organizationId: orgId,
        emailCanonical: 'guest@example.test',
        email: 'guest@example.test',
        tokenHash: createHash('sha256').update(randomBytes(8)).digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
        roleIntents: {
          create: [
            {
              ordinal: 0,
              requestedRoleId: role.role.id,
              liveRoleId: role.role.id,
              roleNameAtIssue: 'Doomed',
            },
          ],
        },
      },
    })
    const detail = (await get(`/${role.role.id}`).expect(200)).body
    expect(detail.holders.total).toBe(1)
    expect(detail.impact.liveInvitationCount).toBe(1)
    await remove(role.role.id, {
      expectedAclVersion: detail.aclVersion,
      expectedLiveInvitationCount: 0,
    })
      .expect(409)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_DELETE_IMPACT_CHANGED'))
    const done = await remove(role.role.id, {
      expectedAclVersion: detail.aclVersion,
      expectedLiveInvitationCount: 1,
    }).expect(200)
    expect(done.body).toMatchObject({
      roleId: role.role.id,
      removedHolderCount: 1,
      affectedInvitationCount: 1,
    })
    expect(await auditRows('org.role_deleted')).toHaveLength(1)
    expect(
      (
        await prisma.orgInviteRoleIntent.findFirstOrThrow({
          where: { requestedRoleId: role.role.id },
        })
      ).liveRoleId
    ).toBeNull()
    expect(await prisma.memberRole.count({ where: { roleId: role.role.id } })).toBe(0)
    await get(`/${role.role.id}`).expect(404)
  })

  it('refuses API keys, other-organization selectors and members without TeamAccess', async () => {
    const key = await http()
      .post('/api-keys')
      .auth(token, { type: 'bearer' })
      .send({ name: 'probe', organizationId: orgId, scopes: ['manage:TeamAccess'] })
      .expect(201)
    await get('', key.body.key).expect(401)
    const outsider = await register('outsider@example.test')
    await get('', outsider.accessToken).expect(403)
    const memberRole = await prisma.role.findFirstOrThrow({
      where: { name: 'MEMBER', isSystem: true },
    })
    const plain = await register('plain@example.test')
    const plainId = context.app.get(JwtService).verify(plain.accessToken).sub
    await seedOrgMember(prisma, { orgId, userId: plainId, roleId: memberRole.id })
    await http()
      .post('/auth/switch-organization')
      .auth(plain.accessToken, { type: 'bearer' })
      .send({ organizationId: orgId })
    await get('', plain.accessToken).expect((res) => expect([401, 403]).toContain(res.status))
  })

  it('treats a role over the editable rule budget as read-only with a truthful count', async () => {
    const big = await prisma.role.create({
      data: { name: 'Huge', organizationId: orgId, isSystem: false },
    })
    const makeRules = async (roleId: string, count: number, prefix: string): Promise<void> => {
      const ids = Array.from({ length: count }, (_, i) => `${prefix}${i}`)
      await prisma.permission.createMany({
        data: ids.map((id) => ({
          id,
          action: 'read',
          subject: 'User',
          conditions: { id },
          fields: [],
          inverted: false,
          organizationId: orgId,
        })),
      })
      await prisma.rolePermission.createMany({
        data: ids.map((permissionId) => ({ roleId, permissionId })),
      })
    }
    await makeRules(big.id, 201, 'huge-')
    const detail = (await get(`/${big.id}`).expect(200)).body
    expect(detail).toMatchObject({
      editMode: 'oversized',
      ruleCount: 201,
      managedPresets: null,
      advancedRules: null,
    })
    await save(big.id, definition(detail))
      .expect(409)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_DEFINITION_OVERSIZED'))
    const listed = (await get('?search=huge').expect(200)).body.data[0]
    expect(listed).toMatchObject({ ruleCount: 201, advancedState: 'unknown' })

    const edge = await prisma.role.create({
      data: { name: 'Edge', organizationId: orgId, isSystem: false },
    })
    await makeRules(edge.id, 200, 'edge-')
    const editable = (await get(`/${edge.id}`).expect(200)).body
    expect(editable).toMatchObject({ editMode: 'editable', ruleCount: 200 })
    expect(editable.advancedRules).toHaveLength(200)
    // Adding a preset would push the resulting definition past the budget: rejected before commit.
    const rev = await revision()
    await save(
      edge.id,
      definition(editable, { presets: [{ capabilityId: 'organization.read', presetId: 'own' }] })
    )
      .expect(409)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_DEFINITION_OVERSIZED'))
    expect(await revision()).toBe(rev)
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM core.role_permissions WHERE "roleId"=$1', [
          edge.id,
        ])
      ).rows[0].n
    ).toBe(200)
  })

  it('accepts a decoded body at the 16384-byte limit and rejects one byte more', async () => {
    const pad = (n: number) => 'x'.repeat(n)
    const fits = JSON.stringify({ name: 'Boundary', description: null, pad: '' })
    expect(fits.length).toBeLessThan(16384)
    const exact =
      `{"name":"Boundary","description":"${pad(0)}"}` +
      ' '.repeat(16384 - `{"name":"Boundary","description":""}`.length)
    expect(Buffer.byteLength(exact)).toBe(16384)
    await http()
      .post(base())
      .auth(token, { type: 'bearer' })
      .set('content-type', 'application/json')
      .send(exact)
      .expect(201)
    const over = exact + ' '
    await http()
      .post(base())
      .auth(token, { type: 'bearer' })
      .set('content-type', 'application/json')
      .send(over)
      .expect(413)
  })
})
