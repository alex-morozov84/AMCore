import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  type MfaProjectionDatabase,
  readMfaPrimaryProjection,
} from '../src/core/auth/mfa/mfa-primary-projection.js'
import { Prisma } from '../src/generated/prisma/client.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

/** Isolated data only; no deployment activation. Actual SQL count, not an ORM-call approximation. */
describe('Compact primary authority SQL projection', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    await fixture.clients[0]!.user.deleteMany()
    await fixture.clients[0]!.browserAuthContext.deleteMany()
  })
  it.each([true, false])(
    'reads protected=%s in one statement and preserves UTC dates without fetching secrets',
    async (protectedAccount) => {
      const client = fixture.clients[0]!,
        f = await createAuthorityAccount(fixture, protectedAccount)
      const queries: Prisma.Sql[] = []
      const observed = {
        $queryRaw: async (query: Prisma.Sql) => {
          queries.push(query)
          return client.$queryRaw(query)
        },
      } as MfaProjectionDatabase
      const projection = await readMfaPrimaryProjection(observed, {
        userId: f.user.id,
        familyId: f.family.id,
      })
      expect(queries).toHaveLength(1)
      expect(projection?.family?.expiresAt.toISOString()).toBe(f.family.expiresAt.toISOString())
      expect(projection?.family?.browserContext?.currentFamilyId).toBe(f.family.id)
      expect(projection?.user.mfaFactor !== null).toBe(protectedAccount)
      expect(queries[0]!.sql).not.toMatch(
        /encryptedSeed|credentialHash|mfa_recovery_codes|mfa_flows/
      )
      const probe = await readMfaPrimaryProjection(observed, {
        refreshHash: f.session.refreshToken,
        familyId: f.family.id,
      })
      expect(queries).toHaveLength(2)
      expect(probe?.session?.id).toBe(f.session.id)
      expect(probe?.now).toBeInstanceOf(Date)
      const plans: unknown[] = []
      for (const query of queries) {
        const [row] = await client.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>(
          Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`
        )
        // Keep physical plan shape/counters only; predicates and outputs can contain bound identifiers.
        const serialized = JSON.stringify(row!['QUERY PLAN'], (key, value: unknown) =>
          ['Output', 'Filter', 'Index Cond', 'Join Filter', 'Hash Cond', 'Merge Cond'].includes(key)
            ? undefined
            : value
        )
        plans.push(JSON.parse(serialized))
      }
      const output = resolve(process.cwd(), '../../.amcore/t076-pr18/auth-cost-optimization')
      await mkdir(output, { recursive: true })
      await writeFile(
        resolve(output, `query-plan-${protectedAccount ? 'protected' : 'ordinary'}.json`),
        JSON.stringify(
          {
            limitation:
              'Small isolated fixtures; query plans are not a production cardinality benchmark. No forced planner settings.',
            plans,
          },
          null,
          2
        ) + '\n'
      )
    }
  )
})
