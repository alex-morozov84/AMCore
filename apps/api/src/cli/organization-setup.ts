/* oxlint-disable no-console -- bounded JSON output is the operator command contract */
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { OrganizationSetupOperations } from '../core/organizations/organization-setup-operations'
import { PrismaClient } from '../generated/prisma/client'

import {
  organizationSetupEnvironment,
  parseOrganizationSetupArgs,
} from './organization-setup-input'

export async function runOrganizationSetup(
  args: string[],
  raw: Record<string, unknown>
): Promise<number> {
  let input: ReturnType<typeof parseOrganizationSetupArgs>
  let env: ReturnType<typeof organizationSetupEnvironment>
  try {
    input = parseOrganizationSetupArgs(args)
    env = organizationSetupEnvironment(raw)
  } catch {
    console.log(
      JSON.stringify({ status: 'invalid_input', nextAction: 'check-command-and-configuration' })
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
  let exit = 0
  let output: unknown
  try {
    const operations = new OrganizationSetupOperations(db, env.ORG_SELF_SERVICE_CREATION_ENABLED)
    const result =
      input.command === 'prepare-account'
        ? await operations.prepare(input.input)
        : input.command === 'bootstrap'
          ? await operations.bootstrap(input.input)
          : input.command === 'account-status'
            ? await operations.account(input.userId)
            : await operations.status()
    // Account lookup is privileged but CLI output never includes an email address.
    output =
      'email' in result
        ? { userId: result.userId, emailVerified: result.emailVerified, state: result.state }
        : result
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'errorCode' in error
        ? String(error.errorCode)
        : 'SETUP_UNCONFIRMED'
    exit = ['SETUP_BUSY', 'SETUP_UNCONFIRMED'].includes(code) ? 4 : 3
    output = {
      status: code,
      ...(exit === 4 ? { state: 'unavailable' } : {}),
      nextAction:
        exit === 4
          ? 'inspect-status-and-repeat-original-intent'
          : 'check-prerequisites-or-recorded-result',
    }
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
if (require.main === module) {
  const deadline = setTimeout(() => {
    console.log(
      JSON.stringify({
        status: 'SETUP_UNCONFIRMED',
        state: 'unavailable',
        nextAction: 'inspect-status-and-repeat-original-intent',
      })
    )
    process.exit(4)
  }, 20000)
  void runOrganizationSetup(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code
    })
    .catch(() => {
      console.log(
        JSON.stringify({
          status: 'SETUP_UNCONFIRMED',
          state: 'unavailable',
          nextAction: 'inspect-status-and-repeat-original-intent',
        })
      )
      process.exitCode = 4
    })
    .finally(() => clearTimeout(deadline))
}
