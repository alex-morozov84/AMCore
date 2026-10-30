/* oxlint-disable no-console -- bounded nonsecret JSON is the administrative command contract */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { MfaEncryptionService } from '../core/auth/mfa/mfa-encryption.service.js'
import { MfaKeyRotation } from '../core/auth/mfa/mfa-key-rotation.js'
import { EnvService } from '../env/env.service.js'
import { PrismaClient } from '../generated/prisma/client.js'

import { mfaMaintenanceEnvironment, parseMfaMaintenanceArgs } from './mfa-maintenance-input.js'

const unconfirmed = { status: 'unconfirmed', nextAction: 'inspect-command-state-before-repeating' }

export async function runMfaMaintenance(
  args: string[],
  raw: Record<string, unknown>
): Promise<number> {
  const normalized = args[0] === '--' ? args.slice(1) : args
  if (['status', 'preflight', 'activate'].includes(normalized[0] ?? '')) {
    const { runMfaDeployment } = await import('./mfa-deployment.js')
    return runMfaDeployment(normalized, raw)
  }
  if (normalized[0] === 'recover') {
    const { runOfflineMfaRecovery } = await import('./mfa-recovery.js')
    return runOfflineMfaRecovery(normalized.slice(1), raw)
  }
  let input: ReturnType<typeof parseMfaMaintenanceArgs>
  let env: ReturnType<typeof mfaMaintenanceEnvironment>
  let encryption: MfaEncryptionService
  try {
    input = parseMfaMaintenanceArgs(args)
    env = mfaMaintenanceEnvironment(raw)
    encryption = new MfaEncryptionService(new EnvService(new ConfigService(env)))
    encryption.assertReady()
  } catch {
    console.log(
      JSON.stringify({ status: 'invalid_input', nextAction: 'check-command-database-and-keyring' })
    )
    return 2
  }
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 3000,
    query_timeout: 5000,
  })
  const db = new PrismaClient({ adapter: new PrismaPg(pool) })
  let output: unknown = unconfirmed
  let exit = 4
  try {
    const result = await new MfaKeyRotation(db, encryption).batch(input.afterUserId)
    output = {
      status: result.failed ? 'partial' : result.remaining ? 'more' : 'complete',
      ...result,
    }
    exit = result.failed ? 3 : 0
  } catch {
    // Some earlier account transactions may have committed; never claim a batch rollback.
    output = unconfirmed
  } finally {
    try {
      await db.$disconnect()
    } catch {
      output = unconfirmed
      exit = 4
    }
    try {
      await pool.end()
    } catch {
      output = unconfirmed
      exit = 4
    }
  }
  console.log(JSON.stringify(output))
  return exit
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  const deadline = setTimeout(() => {
    console.log(JSON.stringify(unconfirmed))
    process.exit(4)
  }, 120000)
  void runMfaMaintenance(process.argv.slice(2), process.env)
    .then((code) => {
      clearTimeout(deadline)
      process.exitCode = code
    })
    .catch(() => {
      clearTimeout(deadline)
      console.log(JSON.stringify(unconfirmed))
      process.exitCode = 4
    })
}
