import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  runAgainstRealRepo,
  validateImageConsistency,
  validateLogsOverlayImages,
} from './validate-image-consistency.mjs'

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

const logsOverlay = `  loki:
    image: grafana/loki:3.7.8@sha256:ccc

  alloy:
    image: grafana/alloy:v1.20.1@sha256:ddd

  logs-grafana:
    image: grafana/grafana:13.2.1@sha256:eee
`
const grafanaCompose = `  grafana:
    image: grafana/grafana:13.2.1@sha256:eee
    profiles: ['monitoring']
`
const ciLogs = `    env:
      LOKI_IMAGE: grafana/loki:3.7.8@sha256:ccc
      ALLOY_IMAGE: grafana/alloy:v1.20.1@sha256:ddd
`

test('matching log overlay pins pass', () => {
  assert.deepEqual(validateLogsOverlayImages(grafanaCompose, logsOverlay, ciLogs), [])
})

test('a drifted Loki pin in CI is rejected', () => {
  const drifted = ciLogs.replace('sha256:ccc', 'sha256:other')
  const violations = validateLogsOverlayImages(grafanaCompose, logsOverlay, drifted)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /loki/)
})

test('a log overlay Grafana that differs from the monitoring Grafana is rejected', () => {
  const drifted = grafanaCompose.replace('sha256:eee', 'sha256:other')
  const violations = validateLogsOverlayImages(drifted, logsOverlay, ciLogs)
  assert.equal(violations.length, 1)
  assert.match(violations[0], /logs-grafana/)
})

test('real docker-compose.yml and ci.yml pins match', () => {
  assert.deepEqual(runAgainstRealRepo(), [])
})
