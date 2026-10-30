/* oxlint-disable no-console -- bounded nonsecret administrative outcomes only */
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { ConfigService } from '@nestjs/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { z } from 'zod'

import { MfaDeployment } from '../core/auth/mfa/mfa-deployment.js'
import { MfaEncryptionService } from '../core/auth/mfa/mfa-encryption.service.js'
import { EnvService } from '../env/env.service.js'
import { PrismaClient } from '../generated/prisma/client.js'

import { mfaArtifactSchema, readMfaFleetEvidence } from './mfa-deployment-evidence.js'
import { mfaMaintenanceEnvironment } from './mfa-maintenance-input.js'
import { offlineMfaEvents } from './mfa-recovery-events.js'

export function parseMfaDeploymentArgs(args: string[]): {
  command: 'status' | 'preflight' | 'activate'
  fleetFile?: string
} {
  const [rawCommand, ...rest] = args
  const command = z.enum(['status', 'preflight', 'activate']).parse(rawCommand)
  const parsed = parseArgs({
    args: rest,
    strict: true,
    tokens: true,
    options: {
      'fleet-file': { type: 'string' },
      'ingress-drained': { type: 'boolean' },
      confirm: { type: 'string' },
    },
  })
  const names = parsed.tokens.map((token) => (token.kind === 'option' ? token.name : ''))
  if (names.includes('') || new Set(names).size !== names.length)
    throw new Error('invalid_arguments')
  if (command === 'status' ? names.length !== 0 : !parsed.values['fleet-file'])
    throw new Error('invalid_arguments')
  if (command === 'activate') {
    if (parsed.values.confirm !== 'ACTIVATE MFA V1' || !parsed.values['ingress-drained'])
      throw new Error('activation_confirmation_required')
  } else if (parsed.values.confirm || parsed.values['ingress-drained'])
    throw new Error('invalid_arguments')
  return { command, fleetFile: parsed.values['fleet-file'] }
}

/** Never contacts a remote host or changes ingress. Failure after a sent transaction is unconfirmed. */
export async function runMfaDeployment(
  args: string[],
  raw: Record<string, unknown>
): Promise<number> {
  let env, input
  try {
    input = parseMfaDeploymentArgs(args)
    env = mfaMaintenanceEnvironment(raw)
  } catch {
    console.log(JSON.stringify({ status: 'invalid_input' }))
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
  const service = new MfaDeployment(
    db,
    new MfaEncryptionService(new EnvService(new ConfigService(env))),
    offlineMfaEvents(db)
  )
  let output: object = { status: 'unconfirmed', nextAction: 'inspect-protocol-before-repeating' },
    exit = 4
  try {
    if (input.command === 'status')
      output = { status: 'local_protocol', ...(await service.status()) }
    else {
      const evidence = await readMfaFleetEvidence(input.fleetFile!)
      const local = mfaArtifactSchema.parse(
        JSON.parse(await readFile(new URL('../mfa-artifact.json', import.meta.url), 'utf8'))
      )
      if (
        local.component !== 'api-worker' ||
        !local.recoveryCommand ||
        local.sourceCommit !== evidence.sourceCommit
      )
        throw new Error('incompatible_command_artifact')
      await service.preflight()
      output = {
        status:
          input.command === 'activate' ? await service.activate(evidence) : 'preflight_passed',
        evidenceHash: evidence.evidenceHash,
        sourceCommit: evidence.sourceCommit,
      }
    }
    exit = 0
  } catch {
    /* Local or sent operation failure stays unconfirmed; never print the raw input/error. */
  } finally {
    for (const close of [() => db.$disconnect(), () => pool.end()]) {
      try {
        await close()
      } catch {
        output = { status: 'unconfirmed', nextAction: 'inspect-protocol-before-repeating' }
        exit = 4
      }
    }
  }
  console.log(JSON.stringify(output))
  return exit
}
