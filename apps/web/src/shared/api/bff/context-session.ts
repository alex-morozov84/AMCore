import { createHash } from 'node:crypto'

import { ContextRequestError } from './context-errors'
import { ensureFreshSession, type EnsureFreshSessionDeps } from './ensure-fresh-session'
import { SessionNotFoundError } from './errors'
import type { VaultEntry } from './session-vault.types'

import 'server-only'

export const CONTEXT_SESSION_HEADER = 'x-amcore-context-session'

// Only the exact capture object can consume its already-completed first-read check once.
const verifiedCaptures = new WeakMap<object, VaultEntry>()

export function validateExpectedContextSession(expected: string | undefined): void {
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new ContextRequestError(400, 'BAD_REQUEST')
  }
}

/** Login/re-login allocates a new random cookie ID; refresh and step-up retain it. */
export function contextSessionBinding(
  sessionId: string,
  entry: VaultEntry,
  version: 1 | 2 = 2
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        version === 1
          ? ['product-context-v1', sessionId, entry.userSnapshot.id]
          : ['product-context-v2', entry.audience ?? 'product', sessionId, entry.userSnapshot.id]
      )
    )
    .digest('hex')
}

export async function captureContextSession(
  sessionId: string | undefined,
  deps: EnsureFreshSessionDeps,
  expected: string | undefined,
  bootstrap = false
): Promise<{ sessionId: string; entry: VaultEntry; binding: string; bindingVersion?: 1 | 2 }> {
  if (!bootstrap) validateExpectedContextSession(expected)
  if (!sessionId) throw new SessionNotFoundError('missing')
  const entry = await deps.store.get(sessionId)
  if (!entry) throw new SessionNotFoundError('missing')
  await deps.verifyBinding(entry)
  const binding = contextSessionBinding(sessionId, entry)
  if (!bootstrap && expected !== binding)
    throw new ContextRequestError(409, 'CONTEXT_SESSION_CHANGED')
  const captured = { sessionId, entry, binding }
  verifiedCaptures.set(captured, entry)
  return captured
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
  // captureContextSession already checked this exact first read in this request.
  // Lock re-reads and every refreshed/replaced record still need a new primary check.
  let capturedProof = verifiedCaptures.get(captured) === captured.entry
  verifiedCaptures.delete(captured)
  const verifyBinding = async (entry: VaultEntry) => {
    if (capturedProof && entry === captured.entry) {
      capturedProof = false
      return
    }
    capturedProof = false
    await deps.verifyBinding(entry)
  }
  const entry = await ensureFreshSession(captured.sessionId, { ...deps, store, verifyBinding })
  if (
    contextSessionBinding(captured.sessionId, entry, captured.bindingVersion ?? 2) !==
    captured.binding
  ) {
    throw new ContextRequestError(409, 'CONTEXT_SESSION_CHANGED')
  }
  return entry
}
