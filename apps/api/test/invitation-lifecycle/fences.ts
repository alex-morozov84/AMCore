import { invitationClientQuery } from '../helpers/invitation-operation'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
import { invitationFence, observeInvitationWait } from '../helpers/invitation-race'

export function registerFenceProofs(getFixture: () => InvitationProofFixture): void {
  it('F2 fence skips unrelated transactions and pauses its target only once', async () => {
    const { prisma } = getFixture()
    let matches = 0
    const fence = invitationFence(prisma, (model, method, args) => {
      if (
        model !== '$sql' ||
        method !== '$queryRaw' ||
        !String(args[0]).includes('target_boundary')
      )
        return false
      matches++
      return true
    })
    let target: Promise<unknown> | undefined
    try {
      await prisma.$transaction((tx) => tx.$queryRaw`SELECT 1 AS unrelated_boundary`)
      target = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 AS target_boundary`
        await tx.$queryRaw`SELECT 2 AS target_boundary`
      })
      await fence.waitFor(target)
      expect(fence.pid()).toBeGreaterThan(0)
      fence.release()
      await target
      expect(matches).toBe(1)
    } finally {
      fence.restore()
      if (target) await Promise.allSettled([target])
    }
  })

  it('F2 fence fails promptly when the invoked target refuses before its transaction', async () => {
    const { prisma } = getFixture()
    const fence = invitationFence(prisma, () => false)
    try {
      await expect(fence.waitFor(Promise.reject(new Error('early refusal')))).rejects.toThrow(
        'early refusal'
      )
      await expect(fence.waitFor(Promise.resolve(403))).rejects.toThrow(
        'Target operation completed before fence'
      )
    } finally {
      fence.restore()
    }
  })

  it('F2 exact waiter observation rejects an unrelated backend despite a matching decoy wait', async () => {
    const { pool, orgId } = getFixture()
    const blocker = await pool.connect()
    const decoy = await pool.connect()
    const target = await pool.connect()
    let waiting: Promise<unknown> | undefined
    try {
      await blocker.query('BEGIN')
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      await blocker.query('SELECT id FROM core.organizations WHERE id=$1 FOR UPDATE', [orgId])
      waiting = invitationClientQuery(
        decoy,
        'SELECT id FROM core.organizations WHERE id=$1 FOR UPDATE',
        [orgId]
      )
      await observeInvitationWait(pool, waiting, pid, 'core.organizations')
      const unrelated = invitationClientQuery(target, 'SELECT 1', [])
      await expect(
        observeInvitationWait(pool, unrelated, pid, 'core.organizations')
      ).rejects.toThrow('Expected exact waiter')
    } finally {
      await blocker.query('ROLLBACK')
      if (waiting) await Promise.allSettled([waiting])
      blocker.release()
      decoy.release()
      target.release()
    }
  })
}
