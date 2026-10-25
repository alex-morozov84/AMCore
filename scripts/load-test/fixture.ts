/* oxlint-disable no-console -- one-shot operator tool; prints counts, never secrets */
// Load-test fixtures for a disposable deployment (docs/operations/load-testing.md).
// Runs from the API build stage via docker/compose/load-test.yml, started only by
// scripts/load-test/fixture.sh after it verified the Postgres volume label on the host.
// Fresh database → owner + organization through the API, then members, roles, audit rows
// and a run marker in one transaction. Same run, complete and matching → reuse.
// Anything else → refuse without writes; the remedy is recreating this run's project.
import { readFileSync } from 'node:fs'

import { PrismaPg } from '@prisma/adapter-pg'
import * as argon2 from 'argon2'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'

const MEMBERS = 200
const ORG_ADMINS = 20 // members 1–20; the team list is admin-only
const AUDIT_ROWS = 1000
const AUDIT_ACTION = 'admin.user.sessions_viewed'
const API = 'http://api:5002/api/v1'

const run = process.env.LOAD_TEST_RUN_ID ?? ''
const url = process.env.MIGRATION_DATABASE_URL ?? ''
const fail = (message: string): never => {
  throw new Error(`load-fixture refused: ${message}`)
}
function preconditions(): string {
  if (!/^[a-z0-9]{4,32}$/.test(run))
    fail('LOAD_TEST_RUN_ID must be 4–32 lowercase letters or digits')
  if (process.env.LOAD_TEST_OWNERSHIP_CHECKED !== run)
    fail('volume ownership was not verified by fixture.sh')
  if (!URL.canParse(url) || new URL(url).hostname !== 'postgres')
    fail("MIGRATION_DATABASE_URL must point at this project's postgres service")
  const file = process.env.LOAD_TEST_FIXTURE_PASSWORD_FILE ?? ''
  let secret = ''
  try {
    secret = readFileSync(file, 'utf8').trim()
  } catch {
    fail(`cannot read the fixture password file ${file}`)
  }
  if (secret.length < 16 || !/[A-Z]/.test(secret) || !/[0-9]/.test(secret))
    fail('fixture password must have 16+ characters with an upper-case letter and a digit')
  return secret
}
let password = ''
try {
  password = preconditions()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'load-fixture refused')
  process.exit(1)
}

export const memberEmail = (i: number): string =>
  `lt-member-${String(i).padStart(3, '0')}@example.test`
const ownerEmail = 'lt-owner@example.test'
const orgSlug = `lt-${run}`

const pool = new Pool({ connectionString: url, max: 2 })
const db = new PrismaClient({ adapter: new PrismaPg(pool) })

async function marker(): Promise<{ run_id: string }[] | null> {
  const [t] = await db.$queryRaw<
    { t: string | null }[]
  >`SELECT to_regclass('public.amcore_load_test_fixture')::text AS t`
  return t?.t ? db.$queryRaw`SELECT run_id FROM public.amcore_load_test_fixture` : null
}

async function complete(): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } })
  if (!org) return false
  const [members, admins, audit, owner] = await Promise.all([
    db.orgMember.count({
      where: { organizationId: org.id, user: { email: { startsWith: 'lt-member-' } } },
    }),
    db.memberRole.count({
      where: {
        member: { organizationId: org.id, user: { email: { startsWith: 'lt-member-' } } },
        role: { name: 'ADMIN', organizationId: null },
      },
    }),
    db.auditLog.count({ where: { action: AUDIT_ACTION } }),
    db.user.count({ where: { emailCanonical: ownerEmail, systemRole: 'SUPER_ADMIN' } }),
  ])
  return members === MEMBERS && admins === ORG_ADMINS && audit === AUDIT_ROWS && owner === 1
}

async function api(path: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) fail(`API ${path} answered ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

async function create(): Promise<void> {
  const registered = await api('/auth/register', { email: ownerEmail, password })
  const token = String(registered.accessToken ?? '')
  const org = await api('/organizations', { name: `Load test ${run}`, slug: orgSlug }, token)
  const templates = await db.role.findMany({
    where: { organizationId: null, isSystem: true, name: { in: ['MEMBER', 'ADMIN'] } },
  })
  const role = (name: string): string =>
    templates.find((r) => r.name === name)?.id ?? fail(`no ${name} template (run the seed)`)
  const hash = await argon2.hash(password)
  await db.$transaction(async (tx) => {
    for (let i = 1; i <= MEMBERS; i++) {
      const email = memberEmail(i)
      await tx.user.create({
        data: {
          email,
          emailCanonical: email,
          emailVerified: true,
          passwordHash: hash,
          name: `Load member ${i}`,
          memberships: {
            create: {
              organizationId: String(org.id),
              roles: { create: { roleId: role(i <= ORG_ADMINS ? 'ADMIN' : 'MEMBER') } },
            },
          },
        },
      })
    }
    const owner = await tx.user.update({
      where: { emailCanonical: ownerEmail },
      data: { systemRole: 'SUPER_ADMIN', emailVerified: true },
    })
    await tx.organization.update({
      where: { id: String(org.id) },
      data: { aclVersion: { increment: 1 } },
    })
    await tx.auditLog.createMany({
      data: Array.from({ length: AUDIT_ROWS }, (_, i) => ({
        actorType: 'USER' as const,
        actorId: owner.id,
        action: AUDIT_ACTION,
        targetType: 'USER' as const,
        targetId: owner.id,
        category: 'SECURITY' as const,
        metadata: { page: 1 + (i % 5), limit: 20, resultCount: 0 },
      })),
    })
    await tx.$executeRaw`CREATE TABLE public.amcore_load_test_fixture (run_id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`
    await tx.$executeRaw`INSERT INTO public.amcore_load_test_fixture (run_id) VALUES (${run})`
  })
}

async function main(): Promise<void> {
  const rows = await marker()
  if (rows) {
    if (rows.length !== 1 || rows[0]?.run_id !== run)
      fail('the database belongs to another load-test run')
    if (!(await complete()))
      fail('fixtures are partial or changed; recreate this run project (down -v)')
    console.log(
      `load-fixture: reused run ${run} (members ${MEMBERS}, org admins ${ORG_ADMINS}, audit ${AUDIT_ROWS})`
    )
    return
  }
  const [users, orgs] = await Promise.all([db.user.count(), db.organization.count()])
  if (users !== 0 || orgs !== 0)
    fail(`not a fresh database (users ${users}, organizations ${orgs}); recreate this run project`)
  await create()
  if (!(await complete())) fail('created fixtures do not match the expected counts')
  console.log(
    `load-fixture: created run ${run} (org ${orgSlug}, members ${MEMBERS}, org admins ${ORG_ADMINS}, audit ${AUDIT_ROWS})`
  )
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'load-fixture failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
    await pool.end()
  })
