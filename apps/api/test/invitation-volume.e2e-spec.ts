import { Pool } from 'pg'

import { type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

// SQL-plan evidence complements HTTP/transaction proofs; it is not a latency SLO.
describe('Invitation inventory representative query plans', () => {
  let context: E2ETestContext
  let pool: Pool
  beforeAll(async () => {
    context = await setupE2ETest()
    pool = new Pool({ connectionString: context.postgresContainer.getConnectionUri() })
    await context.prisma.organization.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        id: `volume-org-${i}`, name: `Volume ${i}`, slug: `volume-${i}`,
      })),
    })
    await pool.query(`
      INSERT INTO core.org_invites
        (id,"organizationId",email,"emailCanonical","tokenHash","issuedAt","expiresAt","updatedAt")
      SELECT 'volume-invite-'||i, 'volume-org-'||(i % 100),
        'volume-'||i||'@example.test', 'volume-'||i||'@example.test',
        md5('fake-volume-'||i)||md5('fake-second-'||i),
        now() - (i||' seconds')::interval,
        now() + ((CASE WHEN i % 7 = 0 THEN -24 ELSE 24 END)||' hours')::interval, now()
      FROM generate_series(1,10000) i`)
    await pool.query('ANALYZE core.org_invites')
  }, 120000)
  afterAll(async () => {
    await pool?.end()
    if (context) await teardownE2ETest(context)
  }, 120000)

  it('records pending, expired, search, count and token plans without forcing planner options', async () => {
    const visibility = `"organizationId"='volume-org-15' AND "acceptedAt" IS NULL AND "revokedAt" IS NULL`
    const probes = {
      pending: `SELECT id FROM core.org_invites WHERE ${visibility} AND "expiresAt">now() ORDER BY "issuedAt" DESC,id ASC LIMIT 20`,
      expired: `SELECT id FROM core.org_invites WHERE ${visibility} AND "expiresAt"<=now() AND "expiresAt">now()-interval '30 days' ORDER BY "issuedAt" DESC,id ASC LIMIT 20`,
      search: `SELECT id FROM core.org_invites WHERE ${visibility} AND "expiresAt">now() AND "emailCanonical" LIKE '%volume-15%' ORDER BY "issuedAt" DESC,id ASC LIMIT 20`,
      count: `SELECT count(*) FROM core.org_invites WHERE ${visibility} AND "expiresAt">now()`,
      token: `SELECT id FROM core.org_invites WHERE "tokenHash"=md5('fake-volume-15')||md5('fake-second-15')`,
    }
    const plans: Record<string, unknown> = {}
    for (const [name, query] of Object.entries(probes)) {
      const result = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`)
      const plan = result.rows[0]['QUERY PLAN'][0]
      expect(plan['Execution Time']).toBeGreaterThanOrEqual(0)
      expect(JSON.stringify(plan)).not.toContain('"Plan Rows":10000')
      plans[name] = plan
      console.info('invitation_volume_plan', JSON.stringify({ name, rows: 10000, organizations: 100, plan }))
    }
    expect(JSON.stringify(plans.pending)).toContain('org_invites_organizationId_issuedAt_id_idx')
    expect(JSON.stringify(plans.token)).toContain('org_invites_tokenHash_key')
  })
})
