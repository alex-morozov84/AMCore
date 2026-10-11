import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertUnreferenced } from './image-consumers.mjs'

const first = 'a'.repeat(64),
  second = 'b'.repeat(64)
const candidate = `sha256:${'c'.repeat(64)}`
const unrelated = { Id: first, Image: `sha256:${'d'.repeat(64)}`, Mounts: [] }
const missing = (id = first, patch = {}) =>
  Object.assign(
    new Error(`docker failed (1): Error response from daemon: No such container: ${id}`),
    { stderr: `Error response from daemon: No such container: ${id}\n`, ...patch }
  )
function engine({ initial = first, confirmation = '', error, objects = [unrelated] } = {}) {
  let lists = 0
  const calls = []
  const execute = async (args) => {
    calls.push(args)
    if (args[1] === 'ls') {
      if (++lists === 1) return initial
      if (confirmation instanceof Error) throw confirmation
      return confirmation
    }
    if (error && args[2] === first) throw error
    return typeof objects === 'string' ? objects : JSON.stringify(objects)
  }
  return { execute, calls }
}

test('exact missing ID requires independent confirmed absence on the same execute', async () => {
  const docker = engine({ error: missing() })
  await assertUnreferenced(docker.execute, [candidate])
  assert.equal(docker.calls.length, 3)
  assert.equal(docker.calls[2][1], 'ls')
  await assertUnreferenced(engine({ initial: '' }).execute, [candidate])
  await assertUnreferenced(engine().execute, [candidate])
})

test('disappeared unrelated ID never hides surviving Image or Mounts consumers', async () => {
  for (const consumer of [
    { Id: second, Image: candidate, Mounts: [] },
    {
      Id: second,
      Image: unrelated.Image,
      Mounts: [{ Type: 'bind', Source: candidate, Destination: '/proof' }],
    },
  ]) {
    const docker = engine({
      initial: `${first}\n${second}`,
      confirmation: second,
      error: missing(),
      objects: [consumer],
    })
    await assert.rejects(
      () => assertUnreferenced(docker.execute, [candidate]),
      /referenced by a container/
    )
    assert.ok(docker.calls.some((args) => args[1] === 'inspect' && args[2] === second))
  }
})

test('only exact ordinary missing-object failure permits confirmation', async () => {
  for (const error of [
    missing(second),
    missing(first, { stderr: undefined }),
    missing(first, { code: 'ETIMEDOUT' }),
    missing(first, { signal: 'SIGTERM' }),
    Object.assign(new Error('docker failed (SIGKILL): stopped'), { stderr: missing().stderr }),
    new Error('permission denied'),
    new Error('Cannot connect to Docker daemon'),
  ]) {
    const docker = engine({ error })
    await assert.rejects(() => assertUnreferenced(docker.execute, [candidate]))
    assert.equal(docker.calls.length, 2, 'no absence fallback for unrelated errors')
  }
})

test('absence must be complete, successful and must exclude the exact missing ID', async () => {
  for (const confirmation of [
    first,
    'abc',
    `${second}\n${second}`,
    'not-an-id',
    new Error('transport'),
  ]) {
    await assert.rejects(() =>
      assertUnreferenced(engine({ error: missing(), confirmation }).execute, [candidate])
    )
  }
  for (const initial of ['abc', `${first}\n${first}`, 'not-an-id'])
    await assert.rejects(
      () => assertUnreferenced(engine({ initial }).execute, [candidate]),
      /inventory identities/
    )
})

test('malformed or partial inspections and mount references fail closed', async () => {
  const objects = [
    '{',
    'null',
    '[]',
    '[null]',
    [unrelated, unrelated],
    [{ ...unrelated, Id: second }],
    [{ ...unrelated, Id: 'abc' }],
    [{ ...unrelated, Image: undefined }],
    [{ ...unrelated, Image: 'sha256:abc' }],
    [{ ...unrelated, Mounts: undefined }],
    [{ ...unrelated, Mounts: {} }],
    [{ ...unrelated, Mounts: [null] }],
    [{ ...unrelated, Mounts: [{ Type: 'bind', Source: '/x' }] }],
    [{ ...unrelated, Mounts: [{ Type: 'bind', Source: '', Destination: '/x' }] }],
    [{ ...unrelated, Mounts: [{ Type: 'volume', Source: '/x', Destination: '/x' }] }],
  ]
  for (const item of objects)
    await assert.rejects(() => assertUnreferenced(engine({ objects: item }).execute, [candidate]))
  await assertUnreferenced(
    engine({
      objects: [{ ...unrelated, Mounts: [{ Type: 'tmpfs', Source: '', Destination: '/x' }] }],
    }).execute,
    [candidate]
  )
})

test('confirmed disappearance cannot suppress a later container inspection failure', async () => {
  const docker = engine({ initial: `${first}\n${second}`, confirmation: second, error: missing() })
  await assert.rejects(
    () =>
      assertUnreferenced(
        async (args) => {
          if (args[1] === 'inspect' && args[2] === second)
            throw new Error('permission denied on survivor')
          return docker.execute(args)
        },
        [candidate]
      ),
    /permission denied on survivor/
  )
})
