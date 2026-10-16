import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'

import { PrismaClient } from '../src/generated/prisma/client'

import { e2eContainerLabels } from './e2e-owned-containers'

describe('Public Prisma nested transactions and caller options', () => {
  let container: StartedPostgreSqlContainer
  let pool: Pool
  let prisma: PrismaClient

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    pool = new Pool({ connectionString: container.getConnectionUri() })
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    await prisma.$executeRaw`CREATE TABLE transaction_probe (id integer PRIMARY KEY)`
  }, 120000)
  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM transaction_probe`
  })
  afterAll(async () => {
    try {
      await prisma?.$disconnect()
    } finally {
      try {
        await pool?.end()
      } finally {
        await container?.stop()
      }
    }
  })

  it('does not mutate reusable caller options during a nested transaction', async () => {
    const options = { maxWait: 5000, timeout: 5000 }
    await prisma.$transaction(async (outer) => {
      await outer.$transaction(async (inner) => {
        await inner.$executeRaw`INSERT INTO transaction_probe VALUES (1)`
      }, options)
    }, options)
    expect(options).toStrictEqual({ maxWait: 5000, timeout: 5000 })
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO transaction_probe VALUES (2)`
    }, options)
    expect(await prisma.$queryRaw`SELECT id FROM transaction_probe ORDER BY id`).toEqual([
      { id: 1 },
      { id: 2 },
    ])
  })

  it('rolls back the nested savepoint while preserving outer work', async () => {
    await prisma.$transaction(async (outer) => {
      await outer.$executeRaw`INSERT INTO transaction_probe VALUES (1)`
      await expect(
        outer.$transaction(async (inner) => {
          await inner.$executeRaw`INSERT INTO transaction_probe VALUES (2)`
          throw new Error('nested rollback')
        })
      ).rejects.toThrow('nested rollback')
      expect(await outer.$queryRaw`SELECT id FROM transaction_probe ORDER BY id`).toEqual([
        { id: 1 },
      ])
    })
    expect(await prisma.$queryRaw`SELECT id FROM transaction_probe ORDER BY id`).toEqual([
      { id: 1 },
    ])
  })

  it('outer rollback also removes committed nested work', async () => {
    await expect(
      prisma.$transaction(async (outer) => {
        await outer.$transaction(async (inner) => {
          await inner.$executeRaw`INSERT INTO transaction_probe VALUES (1)`
        })
        throw new Error('outer rollback')
      })
    ).rejects.toThrow('outer rollback')
    expect(await prisma.$queryRaw`SELECT id FROM transaction_probe`).toEqual([])
  })
})
