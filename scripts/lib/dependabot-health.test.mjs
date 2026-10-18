import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BACKLOG_WARN,
  backlogCount,
  renderDependabotHealth,
  rootJobHealth,
} from './dependabot-health.mjs'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const root = (createdAt, conclusion, durationMinutes = 6, status = 'completed') => ({
  name: 'npm_and_yarn in /. - Update #1',
  status,
  conclusion,
  createdAt,
  updatedAt: new Date(Date.parse(createdAt) + durationMinutes * 60000).toISOString(),
})

test('backlog counts only same-major packages that are behind', () => {
  const outdated = {
    a: { current: '1.0.0', latest: '1.0.1' },
    b: { current: '2.0.0', latest: '3.0.0' },
    c: { current: '1.2.3', latest: '1.2.3' },
    d: { current: '4.1.0', latest: '4.2.0' },
    e: {},
  }
  assert.equal(backlogCount(outdated), 2)
})

test('a finished latest root job is healthy', () => {
  const runs = [
    root('2026-10-19T06:00:00Z', 'success'),
    root('2026-10-16T06:00:00Z', 'cancelled', 55),
  ]
  assert.equal(rootJobHealth(runs, NOW).state, 'ok')
})

test('a latest job cancelled at the limit reports it and the last success', () => {
  const runs = [
    root('2026-10-19T06:00:00Z', 'cancelled', 55),
    root('2026-10-16T06:00:00Z', 'cancelled', 55),
    root('2026-10-13T06:00:00Z', 'success'),
  ]
  const health = rootJobHealth(runs, NOW)
  assert.equal(health.state, 'failing')
  assert.equal(health.hitLimit, true)
  assert.equal(health.lastSuccess.createdAt, '2026-10-13T06:00:00Z')
})

test('a short cancellation is failing but not blamed on the limit', () => {
  const health = rootJobHealth([root('2026-10-19T06:00:00Z', 'cancelled', 3)], NOW)
  assert.equal(health.state, 'failing')
  assert.equal(health.hitLimit, false)
})

test('other jobs, unfinished runs and old runs are ignored', () => {
  const runs = [
    {
      ...root('2026-10-19T06:00:00Z', 'cancelled', 55),
      name: 'npm_and_yarn in /docker/migrator - Update #2',
    },
    root('2026-10-19T07:00:00Z', null, 10, 'in_progress'),
    root('2026-09-01T06:00:00Z', 'cancelled', 55),
  ]
  assert.equal(rootJobHealth(runs, NOW).state, 'unknown')
})

test('the report warns on a failing job and on a large backlog', () => {
  const runs = { rows: [root('2026-10-19T06:00:00Z', 'cancelled', 55)] }
  const text = renderDependabotHealth({ runs, backlog: { count: BACKLOG_WARN } }).join('\n')
  assert.match(text, /^## Dependabot health/)
  assert.match(text, /did not finish \(cancelled; no success\)/)
  assert.match(text, /killed by the fixed GitHub limit/)
  assert.match(
    text,
    new RegExp(`${BACKLOG_WARN} packages are behind .*\\(warning from ${BACKLOG_WARN}`)
  )
})

test('a probe error degrades to a note instead of throwing', () => {
  const text = renderDependabotHealth({
    runs: { error: 'could not list Dependabot runs' },
    backlog: { error: 'could not run `pnpm outdated`' },
  }).join('\n')
  assert.match(text, /could not list Dependabot runs/)
  assert.match(text, /could not run `pnpm outdated`/)
})
