import { parseArgs } from 'node:util'

import { z } from 'zod'

import {
  type OrganizationBootstrap,
  organizationBootstrapSchema,
  type OrganizationPrepareAccount,
  organizationPrepareAccountSchema,
} from '@amcore/shared'

import { databaseEnv, databaseSslMode } from '../env/schema/database.env'
import { organizationsEnv } from '../env/schema/organizations.env'
import { runtimeEnv } from '../env/schema/runtime.env'

type SetupCommand =
  | { command: 'status' }
  | { command: 'account-status'; userId: string }
  | { command: 'prepare-account'; input: OrganizationPrepareAccount }
  | { command: 'bootstrap'; input: OrganizationBootstrap }

export function parseOrganizationSetupArgs(args: string[]): SetupCommand {
  const [command, ...rest] = args[0] === '--' ? args.slice(1) : args
  const options =
    command === 'prepare-account'
      ? { email: { type: 'string' }, locale: { type: 'string' } }
      : command === 'bootstrap'
        ? {
            name: { type: 'string' },
            slug: { type: 'string' },
            'admin-user-id': { type: 'string' },
          }
        : command === 'account-status'
          ? { 'user-id': { type: 'string' } }
          : command === 'status'
            ? {}
            : undefined
  if (!options) throw new Error('invalid_input')
  // Reject duplicate inputs rather than silently selecting the last value.
  const parsed = parseArgs({
    args: rest,
    options: options as Record<string, { type: 'string' }>,
    strict: true,
    tokens: true,
  })
  const names = parsed.tokens.filter((token) => token.kind === 'option').map((token) => token.name)
  if (new Set(names).size !== names.length) throw new Error('invalid_input')
  if (command === 'prepare-account')
    return { command, input: organizationPrepareAccountSchema.parse(parsed.values) } as const
  if (command === 'bootstrap')
    return {
      command,
      input: organizationBootstrapSchema.parse({
        name: parsed.values.name,
        slug: parsed.values.slug,
        adminUserId: parsed.values['admin-user-id'],
      }),
    } as const
  if (command === 'account-status')
    return { command, userId: z.string().min(1).max(128).parse(parsed.values['user-id']) } as const
  return { command: 'status' } as const
}

const setupEnvironmentSchema = z.object({
  ...databaseEnv.shape,
  ...organizationsEnv.shape,
  NODE_ENV: runtimeEnv.shape.NODE_ENV,
})

/** DB-only boundary: no JWT/Redis/provider credentials and no fallback datasource. */
export function organizationSetupEnvironment(
  raw: Record<string, unknown>
): z.infer<typeof setupEnvironmentSchema> {
  const env = setupEnvironmentSchema.parse(raw)
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
