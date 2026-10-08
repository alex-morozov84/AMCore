import { randomUUID } from 'node:crypto'

import request, { type Test } from 'supertest'

import { SystemRole } from '@amcore/shared'

import { OrgAclVersionService } from '../src/core/auth/org-acl-version.service'
import { PermissionsCacheService } from '../src/core/auth/permissions-cache.service'
import type { OrgMember, User } from '../src/generated/prisma/client'
import { type AppRedisClient, REDIS_CLIENT } from '../src/infrastructure/redis'

import { type E2ETestContext, signAccessToken } from './helpers'

// Keep the fixture result inferred so its service/client types stay exact.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function aclFixture(context: E2ETestContext) {
  const { app, prisma } = context
  const redis = app.get<AppRedisClient>(REDIS_CLIENT)
  const createUser = async (): Promise<User> => {
    const email = `${randomUUID()}@example.com`
    return prisma.user.create({ data: { email, emailCanonical: email, emailVerified: true } })
  }
  const admin = await createUser()
  const target = await createUser()
  const token = (user: typeof admin, orgId?: string): string =>
    signAccessToken(app, {
      sub: user.id,
      email: user.email,
      systemRole: SystemRole.User,
      ...(orgId ? { organizationId: orgId, aclVersion: 0 } : {}),
    })
  const org = (
    await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${token(admin)}`)
      .send({ name: 'ACL race fixture' })
      .expect(201)
  ).body as { id: string }
  const adminToken = token(admin, org.id)
  const targetToken = token(target, org.id)
  const base = `/organizations/${org.id}`
  const http = (method: 'get' | 'post' | 'delete', path: string, bearer = adminToken): Test =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${bearer}`)
      .on('response', (res) => {
        if (res.status === 401) {
          console.error('ACL fixture authentication failure', method, path, res.body)
        }
      })
  // Seeded directly: the legacy create route now advances the organization revision (role writers
  // share one fence), and these scenarios start from the documented revision-zero baseline.
  const role = await prisma.role.create({
    data: { name: 'Controlled capability', organizationId: org.id, isSystem: false },
    select: { id: true },
  })
  const versions = app.get(OrgAclVersionService)
  const permissions = app.get(PermissionsCacheService)
  const key = (v: number): string => `auth:perm:v2:${org.id}:${target.id}:${v}`
  const version = async (): Promise<number> =>
    (await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).aclVersion
  const grant = async (): Promise<{ id: string }> =>
    (
      await http('post', `${base}/roles/${role.id}/permissions`)
        .send({ action: 'manage', subject: 'TeamAccess' })
        .expect(201)
    ).body as { id: string }
  const assign = async (): Promise<void> => {
    await http('post', `${base}/members/${target.id}/roles/${role.id}`).expect(204)
  }
  const remove = async (): Promise<void> => {
    await http('delete', `${base}/members/${target.id}/roles/${role.id}`).expect(204)
  }
  const read = (): Test => http('get', `${base}/roles`, targetToken)
  const member = async (): Promise<OrgMember> =>
    prisma.orgMember.create({ data: { userId: target.id, organizationId: org.id } })
  return {
    app,
    prisma,
    redis,
    admin,
    target,
    org,
    role,
    base,
    http,
    version,
    key,
    adminToken,
    targetToken,
    token,
    versions,
    permissions,
    grant,
    assign,
    remove,
    read,
    member,
  }
}

export function deferredGate(): {
  readonly reached: Promise<void>
  pause: () => Promise<void>
  release: () => void
} {
  let release!: () => void
  let signal!: () => void
  const reached = new Promise<void>((resolve) => {
    signal = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const pause = async (): Promise<void> => {
    signal()
    let timer!: ReturnType<typeof setTimeout>
    try {
      await Promise.race([
        released,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('ACL barrier exceeded 1s')), 1000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const wait = async (): Promise<void> => {
    let timer!: ReturnType<typeof setTimeout>
    try {
      await Promise.race([
        reached,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('ACL barrier was not reached')), 2000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    get reached() {
      return wait()
    },
    pause,
    release,
  }
}

export type AclFixture = Awaited<ReturnType<typeof aclFixture>>
