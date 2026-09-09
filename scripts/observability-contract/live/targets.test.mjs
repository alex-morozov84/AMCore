import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkTargets } from './targets.mjs'

function mockTargetsFetch(activeTargets) {
  return async () => ({
    status: 200,
    json: async () => ({ status: 'success', data: { activeTargets } }),
  })
}

const healthyTarget = (job, instance) => ({
  labels: { job, instance },
  scrapeUrl: `http://${instance}/api/v1/metrics`,
  health: 'up',
  lastError: '',
})

test('exactly the two expected targets, both healthy, passes', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockTargetsFetch([
    healthyTarget('amcore-api', 'api:5002'),
    healthyTarget('amcore-worker', 'worker:5002'),
    {
      labels: { job: 'prometheus', instance: 'localhost:9090' },
      health: 'up',
      scrapeUrl: 'x',
      lastError: '',
    },
  ])
  try {
    assert.deepEqual(await checkTargets(), [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

// R3 regression: a duplicate target for an expected job must fail, not be
// silently accepted by `.find()`/`.some()`.
test('a duplicate target for an expected job is rejected', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockTargetsFetch([
    healthyTarget('amcore-api', 'api:5002'),
    healthyTarget('amcore-api', 'api:5003'),
    healthyTarget('amcore-worker', 'worker:5002'),
  ])
  try {
    const violations = await checkTargets()
    assert.ok(violations.some((v) => v.includes('expected exactly 1 active target, found 2')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

// R3 regression: an unexpected extra target must fail, not be silently
// ignored because only the two expected jobs were checked.
test('an unexpected extra target is rejected', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockTargetsFetch([
    healthyTarget('amcore-api', 'api:5002'),
    healthyTarget('amcore-worker', 'worker:5002'),
    healthyTarget('mystery-service', 'mystery:1234'),
  ])
  try {
    const violations = await checkTargets()
    assert.ok(
      violations.some((v) => v.includes('unexpected active target for job "mystery-service"'))
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Prometheus's own self-scrape target is allowed, not flagged as unexpected", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockTargetsFetch([
    healthyTarget('amcore-api', 'api:5002'),
    healthyTarget('amcore-worker', 'worker:5002'),
    {
      labels: { job: 'prometheus', instance: 'localhost:9090' },
      health: 'up',
      scrapeUrl: 'x',
      lastError: '',
    },
  ])
  try {
    assert.deepEqual(await checkTargets(), [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
