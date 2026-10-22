import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { internalNetwork, isolatedContainer, label } from '../migrator-lifecycle/docker.mjs'
import {
  clientsStopped,
  dispose,
  removeContainer,
  recovery,
} from '../migrator-lifecycle/resources.mjs'
import { safeError, report, withClient, bounded } from '../migrator-lifecycle/safety.mjs'

function fakeDocker(
  f,
  { foreign = false, removeFailure = false, internal = true, extraNetwork = false } = {}
) {
  const present = { container: true, network: true }
  const calls = []
  f.docker = async (args) => {
    calls.push(args)
    const [type, command] = args
    if (command === 'ls')
      return present[type] ? JSON.stringify({ Names: f.containers[0], Name: f.network }) : ''
    if (command === 'inspect')
      return JSON.stringify([
        {
          Id: 'owned-id',
          Driver: 'bridge',
          Internal: internal,
          Labels: { [label]: f.run },
          Config: { Labels: { [label]: foreign ? 'another-run' : f.run } },
          NetworkSettings: {
            Networks: { [f.network]: {}, ...(extraNetwork ? { bridge: {} } : {}) },
          },
        },
      ])
    if (command === 'rm') {
      if (removeFailure && type === 'container')
        throw Object.assign(new Error('controlled cleanup error'), { code: 'DOCKER_ERROR' })
      present[type] = false
    }
    return ''
  }
  return calls
}

test('missing container is harmless and a foreign container cannot be removed', async () => {
  const f = { run: randomUUID(), containers: ['owned-name'], network: 'owned-network' }
  const calls = fakeDocker(f, { foreign: true })
  await assert.rejects(removeContainer(f, f.containers[0]), /Refuse a foreign resource/)
  assert.equal(
    calls.some((args) => args[1] === 'rm'),
    false
  )
  f.docker = async (args) => {
    assert.equal(args[1], 'ls')
    return ''
  }
  await removeContainer(f, f.containers[0])
})

test('failed cleanup preserves journal and combines client and Docker errors', async (t) => {
  const output = []
  t.mock.method(console, 'error', (line) => output.push(JSON.parse(line)))
  const directory = await mkdtemp(join(tmpdir(), 'amcore-lifecycle-unit-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const journalPath = join(directory, 'resources.json')
  await writeFile(journalPath, 'retained recovery journal')
  const f = {
    run: randomUUID(),
    directory,
    journalPath,
    containers: ['owned-name'],
    network: 'owned-network',
    observer: {
      end: async () => {
        throw Object.assign(new Error('controlled close error'), { code: 'CLIENT_ERROR' })
      },
    },
  }
  fakeDocker(f, { removeFailure: true })
  await assert.rejects(dispose(f), (error) => {
    assert.equal(error.errors.length, 2)
    assert.deepEqual(
      error.errors.map((item) => item.code),
      ['CLIENT_ERROR', 'DOCKER_ERROR']
    )
    return true
  })
  assert.equal(await readFile(journalPath, 'utf8'), 'retained recovery journal')
  assert.equal(output[0].verdict, 'CLEANUP_ERROR')
  assert.equal(output[0].journal, journalPath)
})

test('internal network is required and a migrator on a second network is refused', async () => {
  const f = { run: randomUUID(), containers: ['owned-name'], network: 'owned-network' }
  const calls = fakeDocker(f)
  await internalNetwork(f)
  assert.ok(calls[0].includes('--internal'))
  await isolatedContainer(f, f.containers[0])
  fakeDocker(f, { internal: false })
  await assert.rejects(internalNetwork(f), /Fixture network must forbid external routing/)
  fakeDocker(f, { extraNetwork: true })
  await assert.rejects(isolatedContainer(f, f.containers[0]), /Migrator must join only/)
})

test('safe error output preserves causes without arbitrary messages or credentials', (t) => {
  const failure = Object.assign(new Error('postgres://<user>:<password>@<host>/<database>'), {
    code: '28P01',
  })
  const cleanup = Object.assign(new Error('controlled cleanup error'), { code: 'DOCKER_ERROR' })
  const safe = safeError(new AggregateError([failure, cleanup], 'private details'))
  assert.deepEqual(
    safe.causes.map((item) => item.code),
    ['28P01', 'DOCKER_ERROR']
  )
  assert.doesNotMatch(JSON.stringify(safe), /postgres|password|private details/)
  assert.throws(
    () => assert.equal(1, 0, 'Database session survived cancellation'),
    (error) => {
      assert.equal(safeError(error).check, 'Database session survived cancellation')
      return true
    }
  )
  const events = []
  t.mock.method(console, 'log', (line) => events.push(JSON.parse(line).verdict))
  const f = { run: 'test-run', history: [], journal: () => events.push('journal') }
  report(f, 'FAIL', { phase: 'cancellation', error: safeError(failure) })
  events.push('forced cleanup')
  assert.equal(f.history[0].verdict, 'FAIL')
  assert.deepEqual(events, ['FAIL', 'journal', 'forced cleanup'])
})

test('failed connect closes the client and preserves both connect and close errors', async () => {
  let ended = false
  const failure = new Error('controlled connect failure'),
    cleanup = new Error('controlled end failure')
  const f = {
    Client: class {
      constructor(options) {
        assert.equal(options.connectionTimeoutMillis, 10000)
      }
      async connect() {
        throw failure
      }
      async end() {
        ended = true
        throw cleanup
      }
    },
  }
  await assert.rejects(
    withClient(f, 'fixture-only-url', () => assert.fail()),
    (error) => {
      assert.deepEqual(error.errors, [failure, cleanup])
      return true
    }
  )
  assert.equal(ended, true)
})

test('bounded wait rejects an operation that never settles', async () => {
  await assert.rejects(bounded(new Promise(() => {}), 5, 'CONTROLLED_TIMEOUT'), {
    code: 'CONTROLLED_TIMEOUT',
  })
})

test('recovered clients are only probed, and uncertain ownership cannot permit journal removal', async () => {
  const absent = Object.assign(new Error('controlled missing process'), { code: 'ESRCH' })
  await clientsStopped([{ pid: 123, closed: false }], () => {
    throw absent
  })
  const denied = Object.assign(new Error('controlled permission failure'), { code: 'EPERM' })
  await assert.rejects(
    clientsStopped([{ pid: 123, closed: false }], () => {
      throw denied
    }),
    (error) => error === denied
  )
  await clientsStopped([{ pid: 123, closed: true }], () =>
    assert.fail('Do not probe a confirmed closed client')
  )
})

test('recovery rejects foreign directory or container names before contacting Docker', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'amcore-lifecycle-unit-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'resources.json'),
    run = randomUUID()
  const state = {
    version: 1,
    run,
    directory: join(tmpdir(), `amcore-migrator-lifecycle-${run}`),
    network: `migrator-lifecycle-${run}`,
    containers: ['foreign-container'],
    endpoint: 'unix:///fixture-only.sock',
  }
  await writeFile(path, JSON.stringify(state))
  assert.throws(() => recovery(path))
  state.containers = [`migrator-lifecycle-${run}-database`]
  state.directory = tmpdir()
  await writeFile(path, JSON.stringify(state))
  assert.throws(() => recovery(path))
})
