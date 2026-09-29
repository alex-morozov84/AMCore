import { createHash } from 'node:crypto'

import { ContextRequestError } from './context-errors'
import { ensureFreshSession, type EnsureFreshSessionDeps } from './ensure-fresh-session'
import { SessionNotFoundError } from './errors'
import type { VaultEntry } from './session-vault.types'

import 'server-only'

export const CONTEXT_SESSION_HEADER = 'x-amcore-context-session'

export function validateExpectedContextSession(expected: string | undefined): void {
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new ContextRequestError(400, 'BAD_REQUEST')
  }
}

/** Login/re-login allocates a new random cookie ID; refresh and step-up retain it. */
export function contextSessionBinding(sessionId: string, entry: VaultEntry): string {
  return createHash('sha256')
    .update(JSON.stringify(['product-context-v1', sessionId, entry.userSnapshot.id]))
    .digest('hex')
}

export async function captureContextSession(
  sessionId: string | undefined,
  deps: EnsureFreshSessionDeps,
  expected: string | undefined,
  bootstrap = false
): Promise<{ sessionId: string; entry: VaultEntry; binding: string }> {
  if (!bootstrap) validateExpectedContextSession(expected)
  if (!sessionId) throw new SessionNotFoundError('missing')
  const entry = await deps.store.get(sessionId)
  if (!entry) throw new SessionNotFoundError('missing')
  const binding = contextSessionBinding(sessionId, entry)
  if (!bootstrap && expected !== binding)
    throw new ContextRequestError(409, 'CONTEXT_SESSION_CHANGED')
  return { sessionId, entry, binding }
}

/** Reuse the captured first read, while retaining the existing refresh lock/CAS re-read. */
export async function freshContextSession(
  captured: Awaited<ReturnType<typeof captureContextSession>>,
  deps: EnsureFreshSessionDeps
): Promise<VaultEntry> {
  let firstRead = true
  const store = {
    create: deps.store.create.bind(deps.store),
    delete: deps.store.delete.bind(deps.store),
    setIfVersionMatches: deps.store.setIfVersionMatches.bind(deps.store),
    get: async (sessionId: string) => {
      if (firstRead && sessionId === captured.sessionId) {
        firstRead = false
        return captured.entry
      }
      return deps.store.get(sessionId)
    },
  }
  const entry = await ensureFreshSession(captured.sessionId, { ...deps, store })
  if (contextSessionBinding(captured.sessionId, entry) !== captured.binding) {
    throw new ContextRequestError(409, 'CONTEXT_SESSION_CHANGED')
  }
  return entry
}
