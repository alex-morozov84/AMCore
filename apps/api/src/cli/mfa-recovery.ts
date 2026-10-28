/* oxlint-disable no-console -- bounded nonsecret administrative outcomes; tickets go only to the private TTY */
import { parseArgs } from 'node:util'

import { HttpException } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { z } from 'zod'

import { requireOfflineMfaAuthority } from '../core/auth/mfa/mfa-offline-authority.js'
import { MfaOfflineRecovery } from '../core/auth/mfa/mfa-offline-recovery.js'
import { PrismaClient } from '../generated/prisma/client.js'

import { mfaMaintenanceEnvironment } from './mfa-maintenance-input.js'
import {
  confirmOfflineMfaReset,
  displayOfflineMfaTicket,
  requirePrivateMfaTerminal,
} from './mfa-private-terminal.js'
import { offlineMfaEvents } from './mfa-recovery-events.js'

export function parseOfflineMfaRecoveryArgs(args: string[]): string {
  const parsed = parseArgs({
    args,
    strict: true,
    tokens: true,
    options: { 'user-id': { type: 'string' } },
  })
  if (parsed.tokens.length !== 1) throw new Error('invalid_input')
  return z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .parse(parsed.values['user-id'])
}

export async function runOfflineMfaRecovery(
  args: string[],
  raw: Record<string, unknown>
): Promise<number> {
  let userId: string
  let env: ReturnType<typeof mfaMaintenanceEnvironment>
  try {
    userId = parseOfflineMfaRecoveryArgs(args)
    env = mfaMaintenanceEnvironment(raw)
  } catch {
    console.log(JSON.stringify({ status: 'invalid_input' }))
    return 2
  }
  try {
    requirePrivateMfaTerminal()
  } catch {
    console.log(JSON.stringify({ status: 'private_terminal_required' }))
    return 3
  }
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 3000,
    query_timeout: 5000,
  })
  const db = new PrismaClient({ adapter: new PrismaPg(pool) })
  let output: object = {
    status: 'unconfirmed',
    nextAction: 'inspect-recovery-state-before-issuing-another-ticket',
  }
  let exit = 4
  let committed = false
  try {
    await requireOfflineMfaAuthority(db)
    const confirmation = await confirmOfflineMfaReset(userId)
    if (confirmation.confirmation !== `RESET ${userId}`) {
      output = { status: 'cancelled' }
      exit = 0
    } else {
      requirePrivateMfaTerminal()
      const issued = await new MfaOfflineRecovery(db, offlineMfaEvents(db)).issue({
        userId,
        ...confirmation,
      })
      committed = true
      displayOfflineMfaTicket(issued.ticket, issued.expiresAt)
      output = { status: 'issued', userId, expiresAt: issued.expiresAt.toISOString() }
      exit = 0
    }
  } catch (error) {
    if (committed)
      output = { status: 'ticket_not_displayed', nextAction: 'issue-a-new-confirmed-ticket' }
    else if (error instanceof HttpException && error.getStatus() === 403) {
      output = {
        status: 'refused',
        nextAction: 'check-owner-authority-password-and-account-policy',
      }
      exit = 3
    }
  } finally {
    try {
      await db.$disconnect()
    } catch {
      output = { ...output, cleanup: 'unconfirmed' }
      exit = 4
    }
    try {
      await pool.end()
    } catch {
      output = { ...output, cleanup: 'unconfirmed' }
      exit = 4
    }
  }
  console.log(JSON.stringify(output))
  return exit
}
