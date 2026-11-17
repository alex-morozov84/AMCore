import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCiPolicy, parseCiRole, resolveCiPolicy } from './ci-policy.mjs'

const policy = (mode) => JSON.stringify({ version: 1, mode })
const product = (event, base, head, fullOnce = false) =>
  resolveCiPolicy({
    role: 'downstream-product',
    repository: 'example/product',
    event,
    base: policy(base),
    head: policy(head),
    fullOnce,
  })

test('proposed mode cannot bypass base-policy before merge, but takes effect on push', () => {
  for (const [base, head] of [
    ['normal', 'heavy-off'],
    ['heavy-off', 'normal'],
    ['heavy-off', 'full'],
  ]) {
    const pr = product('pull_request', base, head)
    assert.equal(pr.mode, base)
    assert.equal(pr.proposed, head)
    assert.equal(product('push', base, head).mode, head)
  }
})

test('malformed head blocks even a valid base; deletion uses normal and full-once never writes saved mode', () => {
  const input = { role: 'downstream-product', event: 'pull_request', base: policy('normal') }
  for (const head of [
    '{',
    '{}',
    '[]',
    policy('unsupported'),
    '{"version":1,"mode":"normal","extra":true}',
  ])
    assert.throws(() => resolveCiPolicy({ ...input, head }))
  assert.equal(
    resolveCiPolicy({ ...input, base: policy('heavy-off'), head: null }).proposed,
    'normal'
  )
  const once = product('workflow_dispatch', 'heavy-off', 'heavy-off', true)
  assert.equal(once.mode, 'full')
  assert.equal(once.saved, 'heavy-off')
  assert.equal(once.proposed, 'heavy-off')
  assert.throws(() => product('pull_request', 'normal', 'normal', true))
  for (const event of ['push', 'schedule', 'release'])
    assert.equal(product(event, 'normal', 'heavy-off').mode, 'heavy-off')
})

test('repository identity and role cannot silently remove upstream safety', () => {
  const line = '- **Mode:** `downstream-product`'
  assert.equal(parseCiRole(line), 'downstream-product')
  assert.throws(() => parseCiRole(`${line}\n${line}`))
  assert.throws(() => parseCiRole('- **Mode:** downstream-product'))
  assert.throws(() =>
    resolveCiPolicy({
      role: 'downstream-product',
      repository: 'alex-morozov84/AMCore',
      event: 'push',
      head: policy('normal'),
    })
  )
  assert.throws(() =>
    resolveCiPolicy({ role: 'upstream-starter', event: 'push', head: policy('heavy-off') })
  )
  assert.deepEqual(parseCiPolicy(null), { version: 1, mode: 'normal' })
  assert.throws(() => parseCiPolicy(undefined))
})
