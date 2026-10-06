import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boot } from './boot.mjs'

const bindFailure = () =>
  Object.assign(new Error('compose up failed'), { stderr: 'Bind for 127.0.0.1:30001 failed' })

function stand() {
  return {
    id: 'e2e-retry',
    purpose: 'e2e',
    topology: 'path',
    sourceHash: 'same-hash',
    uuid: 'old-uuid',
    images: { api: 'sha256:old', web: 'sha256:old-web' },
    builds: [{ invocation: 'old', state: 'settled', outcome: 'succeeded' }],
  }
}

test('late bind failure after the build purges the old identity and rebuilds, transferring nothing', async () => {
  const m = stand()
  const calls = []
  let attempts = 0
  const steps = {
    start: async (current) => {
      calls.push(`start:${current.uuid}`)
      if (++attempts === 1) throw bindFailure()
    },
    cleanup: async (current, purge) => {
      assert.equal(purge, true)
      calls.push(`cleanup:${current.uuid}:images=${Boolean(current.images)}`)
    },
    create: async () => {
      calls.push('create')
      return { id: 'e2e-retry', uuid: 'new-uuid', sourceHash: 'same-hash', purpose: 'e2e' }
    },
  }
  await boot(m, true, steps)
  assert.deepEqual(calls, [
    'start:old-uuid',
    'cleanup:old-uuid:images=true',
    'create',
    'start:new-uuid',
  ])
  assert.equal(m.uuid, 'new-uuid')
  assert.equal(m.images, undefined, 'old image map must not move to the new identity')
  assert.equal(m.builds, undefined, 'old build history stays with the purged identity')
})

test('a failed or incomplete old-owner purge never allocates a new identity', async () => {
  const m = stand()
  let created = false
  const steps = {
    start: async () => {
      throw bindFailure()
    },
    cleanup: async () => {
      throw Object.assign(new Error('unresolved build'), { code: 'BUILD_UNRESOLVED' })
    },
    create: async () => {
      created = true
      return {}
    },
  }
  await assert.rejects(() => boot(m, true, steps), { code: 'BUILD_UNRESOLVED' })
  assert.equal(created, false)
  assert.equal(m.uuid, 'old-uuid')
})

test('source change during recovery, non-bind errors and a final attempt still fail loudly', async () => {
  const changed = stand()
  const base = { cleanup: async () => {}, start: async () => Promise.reject(bindFailure()) }
  await assert.rejects(
    () => boot(changed, true, { ...base, create: async () => ({ sourceHash: 'other' }) }),
    /Source changed during bind recovery/
  )
  await assert.rejects(
    () =>
      boot(stand(), true, {
        ...base,
        start: async () => Promise.reject(new Error('unrelated failure')),
        create: async () => ({}),
      }),
    /unrelated failure/
  )
  let starts = 0
  await assert.rejects(
    () =>
      boot(stand(), true, {
        ...base,
        start: async () => {
          starts++
          throw bindFailure()
        },
        create: async () => ({ sourceHash: 'same-hash' }),
      }),
    /compose up failed/
  )
  assert.equal(starts, 3)
})
