import { PrismaService } from '../src/prisma'

import { type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'
import { holdMemberTransaction } from './helpers/organization-members-race'

describe('Member race fence selects the actual parent lock', () => {
  let context: E2ETestContext
  let prisma: PrismaService
  let orgId: string
  beforeAll(async () => {
    context = await setupE2ETest()
    prisma = context.prisma
  }, 120000)
  beforeEach(async () => {
    orgId = (await prisma.organization.create({ data: { name: 'Fence', slug: 'fence' } })).id
  })
  afterEach(async () => {
    await prisma.organization.delete({ where: { id: orgId } })
  })
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)

  it('an unrelated callback cannot consume the parent-lock fence', async () => {
    const hold = holdMemberTransaction(prisma, false)
    let target: Promise<unknown> | undefined
    try {
      await prisma.$transaction((tx) => tx.$queryRaw`SELECT 1`)
      target = prisma.$transaction(
        (tx) => tx.$queryRaw`SELECT id FROM core.organizations WHERE id = ${orgId} FOR UPDATE`
      )
      const first = await Promise.race([
        hold.entered.then(() => 'held'),
        target.then(() => 'escaped'),
      ])
      expect(first).toBe('held')
      hold.release()
      await target
    } finally {
      hold.restore()
      if (target) await Promise.allSettled([target])
    }
  })

  it('batch transactions pass through without consuming or corrupting the fence', async () => {
    const hold = holdMemberTransaction(prisma, false)
    let target: Promise<unknown> | undefined
    try {
      await expect(
        prisma.$transaction([prisma.organization.findUniqueOrThrow({ where: { id: orgId } })])
      ).resolves.toEqual([expect.objectContaining({ id: orgId })])
      target = prisma.$transaction(
        (tx) => tx.$queryRaw`SELECT id FROM core.organizations WHERE id = ${orgId} FOR UPDATE`
      )
      expect(
        await Promise.race([hold.entered.then(() => 'held'), target.then(() => 'escaped')])
      ).toBe('held')
      hold.release()
      await target
    } finally {
      hold.restore()
      if (target) await Promise.allSettled([target])
    }
  })

  it('restore releases the held transaction and restores subsequent transactions', async () => {
    const original = prisma.$transaction
    const hold = holdMemberTransaction(prisma, false)
    const target = prisma.$transaction(
      (tx) => tx.$queryRaw`SELECT id FROM core.organizations WHERE id = ${orgId} FOR UPDATE`
    )
    try {
      await hold.entered
    } finally {
      hold.restore()
      await target
    }
    expect(prisma.$transaction).toBe(original)
    await expect(prisma.$transaction((tx) => tx.$queryRaw`SELECT 1 AS value`)).resolves.toEqual([
      { value: 1 },
    ])
  })
})
