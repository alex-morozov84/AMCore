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
  })

  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache)
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
        .send({ email: 'member@example.com', roleId: memberRole.id })
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
  })
})
