import { assertProfileInventory } from '../stand/test-inventory.mjs'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

import { productAdminCiLanes, productAdminE2ePlans } from '../product-admin-e2e-plan.mjs'
import { ciLanes, specFiles } from '../e2e-ci-plan.mjs'

test('required staff CI plans cover each declared host spec exactly once', () => {
  const files = Object.values(productAdminE2ePlans)
    .filter((plan) => plan.lane === 'product-admin-real-stack')
    .flatMap((plan) => plan.files)
  assert.deepEqual(
    [...files].sort(),
    readdirSync('apps/web/e2e/product-admin-real-stack')
      .filter((file) => file.endsWith('.spec.ts'))
      .sort()
  )
  assert.equal(new Set(files).size, files.length)
  for (const lane of productAdminCiLanes(process.cwd()))
    assert.ok(ciLanes(process.cwd()).includes(lane))
})

test('path OAuth is assigned to its explicit signed-provider fixture, outside ordinary groups', () => {
  assert.ok(
    !specFiles(process.cwd()).some((file) => file.endsWith('product-admin-oauth-path.spec.ts'))
  )
  const plan = productAdminE2ePlans['staff-path-oauth']
  if (plan) {
    assert.deepEqual(plan.files, ['product-admin-oauth-path.spec.ts'])
    assert.equal(plan.fixture, 'product-admin-oauth-path')
  } else {
    assert.equal(existsSync('apps/web/e2e/real-stack/product-admin-oauth-path.spec.ts'), false)
  }
})

test('actual staff collection fails on missing, extra or duplicate discovered test identities', () => {
  const plan = { lane: 'product-admin-real-stack', files: ['a.spec.ts', 'b.spec.ts'] }
  const tests = [
    { id: 'a', file: 'e2e/product-admin-real-stack/a.spec.ts' },
    { id: 'b', file: 'e2e/product-admin-real-stack/b.spec.ts' },
  ]
  assert.doesNotThrow(() => assertProfileInventory(tests, plan))
  for (const broken of [
    [],
    tests.slice(1),
    [...tests, tests[0]],
    [...tests, { id: 'extra', file: 'e2e/product-admin-real-stack/extra.spec.ts' }],
  ])
    assert.throws(() => assertProfileInventory(broken, plan))
})
