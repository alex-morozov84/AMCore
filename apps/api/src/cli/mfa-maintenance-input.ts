import { parseArgs } from 'node:util'

import { z } from 'zod'

import { authEnv } from '../env/schema/auth.env.js'
import { databaseEnv, databaseSslMode } from '../env/schema/database.env.js'
import { runtimeEnv } from '../env/schema/runtime.env.js'

export function parseMfaMaintenanceArgs(args: string[]): { afterUserId?: string } {
  const [command, ...rest] = args[0] === '--' ? args.slice(1) : args
  if (command !== 'rotate-key') throw new Error('invalid_input')
  const parsed = parseArgs({
    args: rest,
    strict: true,
    tokens: true,
    options: { 'after-user-id': { type: 'string' } },
  })
  if (parsed.tokens.filter((token) => token.kind === 'option').length > 1)
    throw new Error('invalid_input')
  const value = parsed.values['after-user-id']
  return value === undefined ? {} : { afterUserId: z.string().min(1).max(128).parse(value) }
}

const environment = z.object({
  ...databaseEnv.shape,
  NODE_ENV: runtimeEnv.shape.NODE_ENV,
  MFA_ACTIVE_KEY_ID: authEnv.shape.MFA_ACTIVE_KEY_ID,
  MFA_ENCRYPTION_KEYS: authEnv.shape.MFA_ENCRYPTION_KEYS,
})

/** Explicit datasource and MFA keyring only; no HTTP/Redis/JWT application initialization. */
export function mfaMaintenanceEnvironment(
  raw: Record<string, unknown>
): z.infer<typeof environment> {
  const env = environment.parse(raw)
  const url = new URL(env.DATABASE_URL)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  )
    throw new Error('invalid_config')
  if (
    env.NODE_ENV === 'production' &&
    !['require', 'verify-full'].includes(databaseSslMode(env.DATABASE_URL) ?? '')
  )
    throw new Error('invalid_config')
  return env
}
