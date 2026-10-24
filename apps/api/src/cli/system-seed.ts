/* oxlint-disable no-console -- bounded JSON output is the operator command contract */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { databaseSqlState } from '../core/organizations/establishment-error.js'
import { seedAiCatalog } from '../core/system-seed/seed-ai-catalog.js'
import { seedOrgRoles } from '../core/system-seed/seed-org-roles.js'
import { databaseSslMode } from '../env/schema/database.env.js'
import { PrismaClient } from '../generated/prisma/client.js'

// The seed's own refusals carry no secret; anything else is reported by SQLSTATE only.
const REFUSALS: Record<string, string> = {
  'Ambiguous system templates; audit and recover before seed': 'TEMPLATES_AMBIGUOUS',
  'Installed templates require controlled migration': 'TEMPLATES_REQUIRE_MIGRATION',
  'Reserved permission collision; audit before seed': 'PERMISSION_COLLISION',
}

/** Reads the database URL from a named variable: the value never appears in argv or output. */
export function systemSeedUrl(args: string[], raw: Record<string, unknown>): string {
  const { values } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    options: { 'url-from-env': { type: 'string' } },
    strict: true,
  })
  const name = values['url-from-env']
  if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('invalid_input')
  const value = raw[name]
  if (typeof value !== 'string' || !value) throw new Error('invalid_input')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname)
    throw new Error('invalid_input')
  if (raw.NODE_ENV === 'production' && databaseSslMode(value) !== 'verify-full')
    throw new Error('invalid_input')
  return value
}

function failure(error: unknown): { status: string; sqlState?: string } {
  const message = error instanceof Error ? error.message : ''
  if (REFUSALS[message]) return { status: REFUSALS[message] }
  const code = databaseSqlState(error)
  const sqlState = code && /^[0-9A-Z]{5}$/.test(code) ? code : undefined
  return { status: 'SEED_FAILED', ...(sqlState ? { sqlState } : {}) }
}

export async function runSystemSeed(args: string[], raw: Record<string, unknown>): Promise<number> {
  let connectionString: string
  try {
    connectionString = systemSeedUrl(args, raw)
  } catch {
    console.log(JSON.stringify({ status: 'invalid_input', nextAction: 'check-command-and-url' }))
    return 2
  }
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 })
  const db = new PrismaClient({ adapter: new PrismaPg(pool) })
  let output: object = { status: 'seeded' }
  let exit = 0
  try {
    await seedOrgRoles(db)
    await seedAiCatalog(db)
  } catch (error) {
    output = { ...failure(error), nextAction: 'fix-cause-then-rerun' }
    exit = 3
  } finally {
    try {
      await db.$disconnect()
    } finally {
      await pool.end()
    }
  }
  console.log(JSON.stringify(output))
  return exit
}

// Run only when invoked directly.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  void runSystemSeed(process.argv.slice(2), process.env).then(
    (code) => (process.exitCode = code),
    () => {
      console.log(JSON.stringify({ status: 'SEED_FAILED', nextAction: 'fix-cause-then-rerun' }))
      process.exitCode = 3
    }
  )
}
