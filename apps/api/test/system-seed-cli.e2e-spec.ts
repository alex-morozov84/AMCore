import { spawnSync } from 'node:child_process'

import { type AuthorizationDbFixture, authorizationDbFixture } from './authorization-db.fixture'

interface Run {
  status: number | null
  json: Record<string, unknown>
  output: string
}

describe('System seed CLI (real PostgreSQL, deploy command)', () => {
  let db: AuthorizationDbFixture
  const run = (url: string | undefined, extra: NodeJS.ProcessEnv = {}): Run => {
    const env: NodeJS.ProcessEnv = { ...db.environment, DATABASE_URL: '', ...extra }
    if (url === undefined) delete env.SEED_URL
    else env.SEED_URL = url
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/cli/system-seed.ts', '--url-from-env', 'SEED_URL'],
      { env, encoding: 'utf8', timeout: 60000 }
    )
    const last = result.stdout.trim().split('\n').at(-1) ?? '{}'
    return {
      status: result.status,
      json: JSON.parse(last) as Record<string, unknown>,
      output: result.stdout + result.stderr,
    }
  }

  beforeAll(async () => {
    db = await authorizationDbFixture()
  }, 120000)
  afterAll(async () => {
    if (db) await db.close()
  }, 120000)
  beforeEach(async () => {
    await db.reset()
  })

  it('seeds a fresh database, reruns unchanged and exits with the pool closed', async () => {
    const url = db.container.getConnectionUri()
    expect(run(url)).toMatchObject({ status: 0, json: { status: 'seeded' } })
    const ids = (await db.prisma.role.findMany()).map((role) => role.id).sort()
    expect(ids).toHaveLength(3)
    expect(await db.prisma.aiProvider.count()).toBeGreaterThan(0)
    expect(run(url)).toMatchObject({ status: 0, json: { status: 'seeded' } })
    expect((await db.prisma.role.findMany()).map((role) => role.id).sort()).toEqual(ids)
  }, 120000)

  it('refuses installed non-canonical templates without changing them', async () => {
    const url = db.container.getConnectionUri()
    run(url)
    await db.prisma.rolePermission.deleteMany({ where: { role: { name: 'MEMBER' } } })
    const before = await db.prisma.rolePermission.count()
    expect(run(url)).toMatchObject({
      status: 3,
      json: { status: 'TEMPLATES_REQUIRE_MIGRATION', nextAction: 'fix-cause-then-rerun' },
    })
    expect(await db.prisma.rolePermission.count()).toBe(before)
  }, 120000)

  it('fails closed for a role without write privileges and prints no credential', async () => {
    const password = 'seed-cli-limited-not-a-secret'
    await db.pool.query(
      `DROP ROLE IF EXISTS seed_cli_limited; CREATE ROLE seed_cli_limited LOGIN PASSWORD '${password}'; GRANT CONNECT ON DATABASE authorization_test TO seed_cli_limited`
    )
    const url = new URL(db.container.getConnectionUri())
    url.username = 'seed_cli_limited'
    url.password = password
    const result = run(url.toString())
    // 42501 = insufficient_privilege: the SQLSTATE is the only driver detail reported.
    expect(result).toMatchObject({ status: 3, json: { status: 'SEED_FAILED', sqlState: '42501' } })
    expect(result.output).not.toContain(password)
    expect(result.output).not.toContain(url.toString())
    expect(await db.prisma.role.count()).toBe(0)
  }, 120000)

  it('rejects a missing variable and a production URL without verify-full', () => {
    expect(run(undefined)).toMatchObject({ status: 2, json: { status: 'invalid_input' } })
    expect(run(db.container.getConnectionUri(), { NODE_ENV: 'production' })).toMatchObject({
      status: 2,
      json: { status: 'invalid_input' },
    })
  }, 120000)
})
