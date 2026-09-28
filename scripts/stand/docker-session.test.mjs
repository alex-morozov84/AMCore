import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withPinnedEngine } from './docker-session.mjs'
import { orderedInspection, resourceCensus } from './resource-census.mjs'

test('Docker admission proves each fresh scope and pins commands despite context retargeting', async () => {
  let proofs = 0
  const expected = { context: 'local', endpoint: 'unix:///owned.sock' }
  const calls = []
  const dependencies = {
    prove: async () => {
      proofs++
      return { ...expected }
    },
    run: async (...args) => {
      calls.push(args)
      return ''
    },
  }
  for (let i = 0; i < 2; i++)
    await withPinnedEngine(
      expected,
      async (execute) => {
        expected.endpoint = 'unix:///retargeted.sock'
        await execute(['container', 'ls'])
        expected.endpoint = 'unix:///owned.sock'
      },
      dependencies
    )
  assert.equal(proofs, 2)
  assert.deepEqual(
    calls.map((call) => call[1]),
    Array(2).fill(['--host', 'unix:///owned.sock', 'container', 'ls'])
  )
  await assert.rejects(
    () =>
      withPinnedEngine(
        { ...expected, context: 'foreign' },
        () => {
          throw Error('must not execute')
        },
        dependencies
      ),
    /identity changed/
  )
  assert.equal(calls.length, 2)
})

test('batch inspection refuses missing, duplicate, unexpected or ambiguous identities', () => {
  for (const found of [
    [],
    [{ Id: 'aaa1' }, { Id: 'aaa1' }],
    [{ Id: 'aaa1' }, { Id: 'foreign' }],
    [{}, {}],
  ])
    assert.throws(() => orderedInspection('container', ['aaa', 'bbb'], found))
  assert.throws(() => orderedInspection('container', ['a', 'b'], [{ Id: 'ab' }, { Id: 'ac' }]))
  assert.deepEqual(orderedInspection('volume', ['v2', 'v1'], [{ Name: 'v1' }, { Name: 'v2' }]), [
    { Name: 'v2' },
    { Name: 'v1' },
  ])
})

test('fresh census batches each kind once and checks every returned resource', async () => {
  const calls = [],
    checked = []
  const execute = async (args) => {
    calls.push(args)
    if (args[1] === 'ls')
      return args[0] === 'container' ? 'aaa\nbbb' : args[0] === 'network' ? 'nnn' : 'vol'
    return JSON.stringify(
      args[0] === 'container'
        ? [{ Id: 'aaa-full' }, { Id: 'bbb-full' }]
        : args[0] === 'network'
          ? [{ Id: 'nnn-full' }]
          : [{ Name: 'vol' }]
    )
  }
  for (let i = 0; i < 2; i++) {
    const result = await resourceCensus({ uuid: 'own' }, execute, (_, item, kind) =>
      checked.push([kind, item])
    )
    assert.deepEqual(result.resources, {
      container: ['aaa-full', 'bbb-full'],
      network: ['nnn-full'],
      volume: ['vol'],
    })
  }
  assert.equal(calls.length, 12)
  assert.equal(checked.length, 8)
})
