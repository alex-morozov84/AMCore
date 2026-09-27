import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { allocate } from './ports.mjs'

test('an occupied candidate is skipped without touching its listener', async () => {
  const identity = randomUUID()
  const first = await allocate(identity)
  const foreign = createServer()
  await new Promise((resolve, reject) => {
    foreign.once('error', reject)
    foreign.listen(first.web, '127.0.0.1', resolve)
  })
  try {
    const second = await allocate(identity)
    assert.notEqual(second.web, first.web)
    assert.equal(foreign.listening, true)
  } finally {
    await new Promise((resolve) => foreign.close(resolve))
  }
})
