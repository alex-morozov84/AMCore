import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import {
  invitationFailure,
  invitationTransaction,
} from '../../src/core/organizations/invitation-transaction'
import { InviteAcceptLimiterService } from '../../src/core/organizations/invite-accept-limiter.service'
import { PrismaClient } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/prisma'
import { boundedFailure } from '../helpers/invitation-operation'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
import { deferred } from '../helpers/organization-members-race'
const jest = import.meta.jest

export function registerBudgetsProofs(getFixture: () => InvitationProofFixture): void {
  it.each(['raw', 'model'] as const)(
    'R16 real %s adapter deadlock maps known abort409; no retry',
    async (mode) => {
      const { prisma, pool, orgId } = getFixture()
      const secondOrg = await prisma.organization.create({
        data: { name: 'Deadlock fixture', slug: 'deadlock-fixture' },
      })
      const beforeAcl = (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } }))
        .aclVersion
      await pool.query(
        'CREATE TABLE core.t028_deadlock (id integer PRIMARY KEY, value integer NOT NULL); INSERT INTO core.t028_deadlock VALUES (1,0),(2,0)'
      )
      const firstLocked = deferred()
      const secondLocked = deferred()
      const inverse = (
        id: number,
        locked: ReturnType<typeof deferred>,
        other: ReturnType<typeof deferred>
      ): Promise<void> =>
        prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL deadlock_timeout = '100ms'`
            const update = (row: number): Promise<unknown> =>
              mode === 'raw'
                ? tx.$executeRaw`UPDATE core.t028_deadlock SET value=value+1 WHERE id=${row}`
                : tx.organization.update({
                    where: { id: row === 1 ? orgId : secondOrg.id },
                    data: { aclVersion: { increment: 1 } },
                  })
            await update(id)
            locked.resolve()
            await Promise.race([other.promise, boundedFailure('Deadlock partner')])
            await update(3 - id)
          },
          { timeout: 4000 }
        )
      try {
        const results = await Promise.allSettled([
          inverse(1, firstLocked, secondLocked),
          inverse(2, secondLocked, firstLocked),
        ])
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
        expect(['P2010', 'P2034']).toContain(failure.reason.code)
        expect(() => invitationFailure(failure.reason)).toThrow(
          expect.objectContaining({ status: 409 })
        )
        expect(
          (await pool.query('SELECT value FROM core.t028_deadlock ORDER BY id')).rows.map(
            (r) => r.value
          )
        ).toEqual(mode === 'raw' ? [1, 1] : [0, 0])
        expect(
          (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).aclVersion
        ).toBe(beforeAcl + (mode === 'model' ? 1 : 0))
        expect(
          (await prisma.organization.findUniqueOrThrow({ where: { id: secondOrg.id } })).aclVersion
        ).toBe(mode === 'model' ? 1 : 0)
      } finally {
        await pool.query('DROP TABLE core.t028_deadlock')
      }
    }
  )

  it('R16 real lock timeout is bounded infrastructure failure without decision consumption', async () => {
    const { context, pool, orgId, pending, accept, outcome, truth } = getFixture()
    const { token, invite } = await pending()
    const client = await pool.connect()
    await client.query('BEGIN')
    await client.query('SELECT id FROM core.organizations WHERE id=$1 FOR UPDATE', [orgId])
    const consume = jest.spyOn(context.app.get(InviteAcceptLimiterService), 'consume')
    const start = Date.now()
    try {
      expect(await outcome(accept(token))).toBe(503)
      expect(Date.now() - start).toBeGreaterThanOrEqual(1900)
      expect(Date.now() - start).toBeLessThan(4000)
      expect(consume).not.toHaveBeenCalled()
      expect((await truth(invite.id)).members).toEqual([])
    } finally {
      await client.query('ROLLBACK')
      client.release()
      consume.mockRestore()
    }
  })

  it('R16 real interactive pool maxWait expires without transaction execution', async () => {
    const { context, outcome } = getFixture()
    const smallPool = new Pool({
      connectionString: context.postgresContainer.getConnectionUri(),
      max: 1,
    })
    const isolated = new PrismaClient({ adapter: new PrismaPg(smallPool) })
    const entered = deferred()
    const release = deferred()
    const occupying = isolated.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`
        entered.resolve()
        await release.promise
      },
      { timeout: 8000 }
    )
    const work = jest.fn(async () => undefined)
    try {
      await Promise.race([entered.promise, boundedFailure('Pool occupant')])
      const start = Date.now()
      expect(await outcome(invitationTransaction(isolated as unknown as PrismaService, work))).toBe(
        503
      )
      expect(Date.now() - start).toBeGreaterThanOrEqual(1900)
      expect(Date.now() - start).toBeLessThan(4000)
      expect(work).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await occupying
      await isolated.$disconnect()
      await smallPool.end()
    }
  })

  it('R16 four-second transaction budget aborts slow callback without replay', async () => {
    const { prisma, outcome } = getFixture()
    let attempts = 0
    const start = Date.now()
    expect(
      await outcome(
        invitationTransaction(prisma, async (tx) => {
          attempts++
          await tx.$queryRaw`SELECT pg_sleep(4.1)`
        })
      )
    ).toBe(503)
    expect(attempts).toBe(1)
    expect(Date.now() - start).toBeGreaterThanOrEqual(3900)
    expect(Date.now() - start).toBeLessThan(6000)
  })
}
