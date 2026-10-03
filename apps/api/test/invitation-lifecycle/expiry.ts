import type { InvitationProofFixture } from '../helpers/invitation-proof'
import {
  databaseClockPast,
  invitationFence,
  observeInvitationWait,
} from '../helpers/invitation-race'
import { deferred } from '../helpers/organization-members-race'
const jest = import.meta.jest

export function registerExpiryProofs(getFixture: () => InvitationProofFixture): void {
  it.each(['hint', 'user', 'org'] as const)(
    'R12 wall clock crosses expiry during %s fence',
    async (boundary) => {
      const { prisma, pool, orgId, pending, accept, outcome, truth } = getFixture()
      const { token, invite } = await pending()
      const expiry = new Date(Date.now() + 450)
      await prisma.orgInvite.update({ where: { id: invite.id }, data: { expiresAt: expiry } })
      const entered = deferred()
      const release = deferred()
      const original = prisma.orgInvite.findUnique.bind(prisma.orgInvite)
      let intercepted = false
      const hint =
        boundary === 'hint'
          ? jest.spyOn(prisma.orgInvite, 'findUnique').mockImplementation((async (
              args: unknown
            ) => {
              const value = await original(args as never)
              if (!intercepted) {
                intercepted = true
                entered.resolve()
                await release.promise
              }
              return value
            }) as never)
          : undefined
      const user =
        boundary === 'user'
          ? invitationFence(
              prisma,
              (model, method, args) =>
                model === '$sql' && method === '$queryRaw' && String(args[0]).includes('core.users')
            )
          : undefined
      const client = boundary === 'org' ? await pool.connect() : undefined
      let pid = 0
      if (client) {
        await client.query('BEGIN')
        pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
        await client.query('SELECT id FROM core.organizations WHERE id=$1 FOR UPDATE', [orgId])
      }
      const accepting = outcome(accept(token))
      try {
        if (boundary === 'hint') await entered.promise
        if (user) await user.entered
        if (client) await observeInvitationWait(pool, pid, 'core.organizations')
        await databaseClockPast(pool, expiry)
        release.resolve()
        user?.release()
        if (client) await client.query('COMMIT')
        expect(await accepting).toBe(400)
        expect((await truth(invite.id)).members).toEqual([])
      } finally {
        release.resolve()
        hint?.mockRestore()
        user?.restore()
        if (client) {
          await client.query('ROLLBACK')
          client.release()
        }
        await accepting
      }
    }
  )

  it('R12 expiry after actual invite lock wait rejects at wall clock', async () => {
    const { pool, pending, accept, outcome, truth } = getFixture()
    const { token, invite } = await pending()
    const client = await pool.connect()
    await client.query('BEGIN')
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const expiry = new Date(Date.now() + 350)
    await client.query('UPDATE core.org_invites SET "expiresAt"=$2 WHERE id=$1', [
      invite.id,
      expiry.toISOString(),
    ])
    const accepting = outcome(accept(token))
    try {
      await observeInvitationWait(pool, pid, 'core.org_invites')
      await databaseClockPast(pool, expiry)
      await client.query('COMMIT')
      expect(await accepting).toBe(400)
      expect((await truth(invite.id)).members).toEqual([])
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await accepting
    }
  })

  it('R12 claim live then commit after expiry remains accepted', async () => {
    const { prisma, pool, pending, accept, outcome, claim } = getFixture()
    const { token, invite } = await pending()
    const expiry = new Date(Date.now() + 500)
    await prisma.orgInvite.update({ where: { id: invite.id }, data: { expiresAt: expiry } })
    const fence = claim()
    const accepting = outcome(accept(token))
    try {
      await fence.entered
      await databaseClockPast(pool, expiry)
      fence.release()
      expect(await accepting).toBe(200)
    } finally {
      fence.restore()
      await accepting
    }
  })
}
