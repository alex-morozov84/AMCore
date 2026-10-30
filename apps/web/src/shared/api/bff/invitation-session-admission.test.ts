// @vitest-environment node
import { expect, it, vi } from 'vitest'

import type { ContextExecutorDeps } from './context-executor'
import { invitationIncomingSession } from './invitation-request-snapshot'
import { makeEntry } from './test-fakes'

vi.mock('server-only', () => ({}))
function fixture(entry: ReturnType<typeof makeEntry> | null) {
  const verifyBinding = vi.fn().mockResolvedValue(undefined)
  const deps = {
    readSessionId: async () => 's'.repeat(43),
    store: { get: async () => entry },
    verifyBinding,
  } as unknown as ContextExecutorDeps
  return { deps, verifyBinding }
}
it('an inert logged-out handle supplies no identity and no authorization', async () => {
  const { deps, verifyBinding } = fixture(null)
  await expect(invitationIncomingSession(deps)).resolves.toBeNull()
  expect(verifyBinding).not.toHaveBeenCalled()
})
it('a present record is usable only after its primary verification', async () => {
  const entry = makeEntry()
  const { deps, verifyBinding } = fixture(entry)
  const captured = await invitationIncomingSession(deps)
  expect(captured?.entry).toBe(entry)
  expect(verifyBinding).toHaveBeenCalledExactlyOnceWith(entry)
})
it.each(['revoked', 'unavailable'])(
  'a present record never becomes anonymous on primary %s',
  async (reason) => {
    const { deps, verifyBinding } = fixture(makeEntry())
    verifyBinding.mockRejectedValue(new Error(reason))
    await expect(invitationIncomingSession(deps)).rejects.toThrow(reason)
  }
)
it('rejects malformed handles before reading storage', async () => {
  const { deps, verifyBinding } = fixture(null)
  deps.readSessionId = async () => 'malformed'
  await expect(invitationIncomingSession(deps)).rejects.toMatchObject({ status: 409 })
  expect(verifyBinding).not.toHaveBeenCalled()
})
