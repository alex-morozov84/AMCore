import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'

import { MfaEncryptionService } from '../src/core/auth/mfa/mfa-encryption.service.js'
import { MfaProofRepository } from '../src/core/auth/mfa/mfa-proof.repository.js'
import { EnvService } from '../src/env/env.service.js'
import { PrismaClient } from '../src/generated/prisma/client.js'

import { cleanupE2E } from './e2e-cleanup.js'
import { e2eContainerLabels } from './e2e-owned-containers.js'
import { migrateTestDatabase } from './helpers.js'

/** Explicit owned DB only; two clients model separate API processes. */
export class MfaProofFixture {
  private container?: StartedPostgreSqlContainer
  private pools: Pool[] = []
  clients: PrismaClient[] = []
  readonly codec = new MfaEncryptionService(
    new EnvService(
      new ConfigService({
        MFA_ACTIVE_KEY_ID: 'fixture',
        MFA_ENCRYPTION_KEYS: JSON.stringify({ fixture: Buffer.alloc(32, 3).toString('base64') }),
      })
    )
  )
  readonly first = new MfaProofRepository(this.codec)
  readonly second = new MfaProofRepository(this.codec)

  async start(): Promise<void> {
    this.container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .withDatabase('mfa_test')
      .withUsername('test')
      .withPassword('test')
      .start()
    try {
      const url = this.container.getConnectionUri()
      await migrateTestDatabase(url)
      this.pools = [new Pool({ connectionString: url }), new Pool({ connectionString: url })]
      this.clients = this.pools.map((pool) => new PrismaClient({ adapter: new PrismaPg(pool) }))
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async close(): Promise<void> {
    await cleanupE2E([
      ...this.clients.map((client, i) => ({
        name: `mfa-client-${i}`,
        run: () => client.$disconnect(),
        milliseconds: 10000,
      })),
      ...this.pools.map((pool, i) => ({
        name: `mfa-pool-${i}`,
        run: () => pool.end(),
        milliseconds: 10000,
      })),
      {
        name: 'mfa-postgres',
        run: () => this.container?.stop({ timeout: 10000 }),
        milliseconds: 15000,
      },
    ])
    this.clients = []
    this.pools = []
    this.container = undefined
  }
}
