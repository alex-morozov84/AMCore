import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usingConnection } from '../migrator-operations/connection.mjs'
import { safeError } from '../migrator-lifecycle/safety.mjs'

test('failed SQL preserves its primary error after successful connection cleanup', async () => {
  const primary = Object.assign(new Error('fixture statement failure'), { code: 'SQL_FAILURE' })
  let closed = false
  await assert.rejects(
    usingConnection(
      {
        end: async () => {
          closed = true
        },
      },
      async () => {
        throw primary
      }
    ),
    (error) => error === primary
  )
  assert.equal(closed, true)
})

test('failed SQL and failed cleanup both survive without printing credentials', async () => {
  const primary = Object.assign(new Error('postgresql://private:password@fixture'), {
    code: 'SQL_FAILURE',
  })
  const cleanup = Object.assign(new Error('fixture close failure'), { code: 'CLOSE_FAILURE' })
  let destroyed = false
  const client = {
    end: async () => {
      throw cleanup
    },
    connection: {
      stream: {
        destroy: () => {
          destroyed = true
        },
      },
    },
  }
  await assert.rejects(
    usingConnection(client, async () => {
      throw primary
    }),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [primary, cleanup])
      assert.deepEqual(
        safeError(error).causes.map((e) => e.code),
        ['SQL_FAILURE', 'CLOSE_FAILURE']
      )
      assert.equal(JSON.stringify(safeError(error)).includes('password'), false)
      return true
    }
  )
  assert.equal(destroyed, true)
})

test('cleanup failure prevents a successful statement from passing', async () => {
  const cleanup = Object.assign(new Error('fixture close failure'), { code: 'CLOSE_FAILURE' })
  await assert.rejects(
    usingConnection(
      {
        end: async () => {
          throw cleanup
        },
      },
      async () => 'statement completed'
    ),
    (error) => error instanceof AggregateError && error.errors[0] === cleanup
  )
})

test('interruption control refuses an existing journal without starting or recovering it', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { stopHarness } = await import('../migrator-controls/interrupt.mjs')
  const directory = await mkdtemp(join(tmpdir(), 'migrator-journal-guard-'))
  const previous = process.env.AMCORE_MIGRATOR_LIFECYCLE_JOURNAL
  const path = join(directory, 'resources.json')
  const retained = 'existing journal must remain untouched'
  try {
    await writeFile(`${path}.sigterm`, retained)
    process.env.AMCORE_MIGRATOR_LIFECYCLE_JOURNAL = path
    await assert.rejects(stopHarness('must-not-be-started', 'SIGTERM'), /previous control journal/)
    assert.equal(await readFile(`${path}.sigterm`, 'utf8'), retained)
  } finally {
    if (previous === undefined) delete process.env.AMCORE_MIGRATOR_LIFECYCLE_JOURNAL
    else process.env.AMCORE_MIGRATOR_LIFECYCLE_JOURNAL = previous
    await rm(directory, { recursive: true, force: true })
  }
})
