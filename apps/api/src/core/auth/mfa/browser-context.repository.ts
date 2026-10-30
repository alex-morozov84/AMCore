import {
  type BrowserAudience,
  type BrowserContextBootstrap,
  browserContextViewSchema,
  type BrowserRevision,
} from '@amcore/shared'

import type { BrowserAuthContext, Prisma } from '../../../generated/prisma/client.js'

import { hashBrowserBinding } from './browser-binding.js'
import { mfaCredential } from './mfa-secrets.js'
import { mfaDatabaseClock } from './mfa-transaction.js'

type ContextReader = Pick<Prisma.TransactionClient, 'browserAuthContext'>
type BootstrapDatabase = ContextReader & Pick<Prisma.TransactionClient, '$queryRaw'>

/** Caller charges the source start budget first. No account or credential is issued here. */
export async function bootstrapBrowserContext(
  db: BootstrapDatabase,
  audience: BrowserAudience
): Promise<BrowserContextBootstrap> {
  const binding = mfaCredential()
  const now = await mfaDatabaseClock(db)
  const context = await db.browserAuthContext.create({
    data: {
      bindingHash: hashBrowserBinding(binding)!,
      audience,
      expiresAt: new Date(now.getTime() + 900_000),
    },
  })
  return {
    binding,
    view: browserContextViewSchema.parse({
      contextId: context.id,
      generation: context.generation,
      state: context.state,
      expiresAt: context.expiresAt.toISOString(),
    }),
  }
}

/** Identity lookup only; callers must validate revision, expiry and family before admission. */
export async function readBrowserContext(
  db: ContextReader,
  binding: string,
  audience: BrowserAudience
): Promise<BrowserAuthContext | null> {
  const hash = hashBrowserBinding(binding)
  if (!hash) return null
  const context = await db.browserAuthContext.findUnique({ where: { bindingHash: hash } })
  return context?.audience === audience ? context : null
}

/** Take this lock before sorted account locks. Recheck expiry after all waits. */
export async function lockBrowserContext(
  tx: Prisma.TransactionClient,
  binding: string,
  audience: BrowserAudience
): Promise<BrowserAuthContext | null> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
  const hint = await readBrowserContext(tx, binding, audience)
  if (!hint) return null
  await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${hint.id} FOR UPDATE`
  const current = await readBrowserContext(tx, binding, audience)
  return current?.id === hint.id ? current : null
}

export function matchesBrowserRevision(
  context: BrowserAuthContext | null,
  expected: BrowserRevision,
  now: Date
): context is BrowserAuthContext {
  return (
    context !== null &&
    context.id === expected.contextId &&
    context.generation === expected.generation &&
    context.expiresAt > now &&
    ['empty', 'reserved', 'published', 'logged_out'].includes(context.state)
  )
}
