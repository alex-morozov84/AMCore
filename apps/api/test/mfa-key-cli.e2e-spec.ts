import { spawnSync } from 'node:child_process'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Actual MFA key CLI changes only the owned Testcontainers database', () => {
  const fixture = new MfaProofFixture()
  const nextKey = Buffer.alloc(32, 4).toString('base64')
  const oldKey = Buffer.alloc(32, 3).toString('base64')
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    await fixture.clients[0]!.user.deleteMany()
    await fixture.clients[0]!.browserAuthContext.deleteMany()
  })

  function run(args = ['rotate-key'], overrides: NodeJS.ProcessEnv = {}) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: fixture.connectionUri,
      MFA_ACTIVE_KEY_ID: 'next',
      MFA_ENCRYPTION_KEYS: JSON.stringify({ next: nextKey, fixture: oldKey }),
      ...overrides,
    }
    for (const name of ['JWT_SECRET', 'REDIS_URL', 'WEB_FRONTEND_CONTEXT_KEY']) delete env[name]
    const child = spawnSync('pnpm', ['auth:mfa', '--', ...args], {
      env,
      encoding: 'utf8',
      timeout: 60000,
    })
    const output = child.stdout + child.stderr
    expect(child.error).toBeUndefined()
    for (const secret of [fixture.connectionUri, nextKey, oldKey])
      expect(output).not.toContain(secret)
    const lines = child.stdout.split('\n').filter((line) => line.startsWith('{'))
    expect(lines).toHaveLength(1)
    return { status: child.status, body: JSON.parse(lines[0]!) }
  }

  it('rotates once, repeats idempotently and closes its pool without a full app environment', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    expect(run()).toMatchObject({
      status: 0,
      body: { status: 'complete', examined: 1, rotated: 1, failed: 0, remaining: false },
    })
    expect((await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })).keyId).toBe(
      'next'
    )
    expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    expect(run()).toMatchObject({
      status: 0,
      body: { status: 'complete', examined: 0, rotated: 0 },
    })
  }, 120000)

  it('refuses missing read keys without an assurance change or a false complete result', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const before = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    expect(
      run(['rotate-key'], { MFA_ENCRYPTION_KEYS: JSON.stringify({ next: nextKey }) })
    ).toMatchObject({
      status: 3,
      body: { status: 'partial', rotated: 0, failed: 1, remaining: true },
    })
    expect(await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })).toEqual(before)
  }, 120000)

  it('rejects unsupported activation/recovery and reports unavailable DB without exposing configuration', () => {
    expect(run(['activate'])).toMatchObject({ status: 2, body: { status: 'invalid_input' } })
    expect(run(['recover'])).toMatchObject({ status: 2, body: { status: 'invalid_input' } })
    expect(
      run(['rotate-key'], { DATABASE_URL: 'postgresql://fake:fake@127.0.0.1:1/fake' })
    ).toMatchObject({ status: 4, body: { status: 'unconfirmed' } })
  }, 120000)
})
