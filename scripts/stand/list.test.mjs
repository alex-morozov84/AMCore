import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listResources } from './list.mjs'

for (const [kind, message] of [
  ['container', 'Error response from daemon: No such container: gone'],
  ['network', 'Error response from daemon: network gone not found'],
  ['volume', 'Error response from daemon: No such volume: gone'],
]) {
  test(`diagnostic listing tolerates ${kind} removed after enumeration`, async (t) => {
    const log = t.mock.method(console, 'log', () => {})
    const execute = async (_command, args) => {
      if (args.includes('ls')) return 'gone\nlive'
      if (args.at(-1) === 'gone') throw Object.assign(new Error(message), { stderr: message })
      return JSON.stringify([
        { Labels: { 'org.amcore.stand': 'live', 'org.amcore.worktree': '/absent' } },
      ])
    }
    await listResources({ context: 'local' }, kind, execute)
    assert.equal(log.mock.callCount(), 1)
    assert.match(log.mock.calls[0].arguments[0], /live:.*orphan source missing/)
  })
}

test('diagnostic listing propagates Docker transport and permission failures', async () => {
  for (const stderr of ['permission denied', 'Cannot connect to the Docker daemon'])
    await assert.rejects(
      () =>
        listResources({ context: 'local' }, 'network', async (_command, args) => {
          if (args.includes('ls')) return 'owned'
          throw Object.assign(new Error(stderr), { stderr })
        }),
      { message: stderr }
    )
})
