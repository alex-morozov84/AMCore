import { requestCancellation, stopChildren, setJournal } from './process.mjs'
import { randomUUID } from 'node:crypto'
import { root, directory, lease, save } from './state.mjs'
import { assertNoSurvivors } from './survivors.mjs'
import { verifyRunnerRemoval } from './wrapper-removal.mjs'

// Preparation cancellation stops its proved groups without depending on stream close.
// Managed runners opt into direct signalling: await their own cleanup before verification.
export async function cancellation({ fixture, targetId } = {}) {
  let signal
  const controller = new globalThis.AbortController()
  const handlers = new Map()
  for (const name of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (signal) return
      signal = name
      requestCancellation()
      controller.abort(name)
      process.exitCode = name === 'SIGINT' ? 130 : 143
    }
    handlers.set(name, handler)
    process.on(name, handler)
  }
  const id = `wrapper-${randomUUID()}`
  const held = await lease(id, 'wrapper')
  const attempt = randomUUID()
  const standId = targetId ?? `${id}-run`
  const record = {
    version: 1,
    id,
    uuid: randomUUID(),
    attempt,
    worktree: root,
    purpose: 'e2e',
    topology: 'path',
    mocked: true,
    wrapper: true,
    fixture,
    targetManifest: `${fixture ?? root}/.amcore/stands/${standId}/manifest.json`,
    snapshot: `${directory(id)}/source-${attempt}`,
    state: 'wrapper-running',
  }
  await save(record)
  setJournal(`${directory(id)}/lease/children.json`)
  return {
    standId,
    get interrupted() {
      return Boolean(signal)
    },
    signal: controller.signal,
    async finish() {
      try {
        await stopChildren()
        await assertNoSurvivors(record)
        await verifyRunnerRemoval(record)
        record.state = 'purged'
        record.closeout = { verifiedAt: new Date().toISOString() }
        await save(record)
        setJournal(undefined)
        await held.release()
      } catch (error) {
        record.closeout = { incomplete: true, reason: error.message }
        await save(record)
        console.error(`Wrapper cleanup incomplete; retain recovery: ${directory(id)}`)
        throw error
      } finally {
        for (const [name, handler] of handlers) process.off(name, handler)
      }
    },
  }
}
