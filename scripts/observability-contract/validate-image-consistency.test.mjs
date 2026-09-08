import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runAgainstRealRepo, validateImageConsistency } from './validate-image-consistency.mjs'

const compose = `  prometheus:
    image: prom/prometheus:v3.14.0@sha256:aaa
    profiles: ['monitoring']

  alertmanager:
    image: prom/alertmanager:v0.34.0@sha256:bbb
    profiles: ['monitoring']
`

const ciMatching = `    env:
      PROMETHEUS_IMAGE: prom/prometheus:v3.14.0@sha256:aaa
      ALERTMANAGER_IMAGE: prom/alertmanager:v0.34.0@sha256:bbb
`

const ciMismatched = `    env:
      PROMETHEUS_IMAGE: prom/prometheus:v3.14.0@sha256:aaa
      ALERTMANAGER_IMAGE: prom/alertmanager:v0.34.0@sha256:DIFFERENT
`

test('matching image pins pass', () => {
  assert.deepEqual(validateImageConsistency(compose, ciMatching), [])
})

test('a drifted alertmanager pin is rejected', () => {
  const violations = validateImageConsistency(compose, ciMismatched)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /alertmanager/)
})

test('real docker-compose.yml and ci.yml pins match', () => {
  assert.deepEqual(runAgainstRealRepo(), [])
})
