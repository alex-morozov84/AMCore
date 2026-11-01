import { assertProfileInventory } from '../stand/test-inventory.mjs'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

import { productAdminCiLanes, productAdminE2ePlans } from '../product-admin-e2e-plan.mjs'
import { ciLanes, specFiles } from '../e2e-ci-plan.mjs'

function profileConfig(plan) {
  const filename = `apps/web/playwright.${plan.lane}.config.ts`
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  })
  const exports = {}
  runInNewContext(
    outputText,
    {
      exports,
      process: { env: {} },
      require(name) {
        if (name === '@playwright/test')
          return { defineConfig: (config) => config, devices: { 'Desktop Chrome': {} } }
        if (name === './e2e/support/managed-target.mjs')
          return {
            activeTarget: () => ({ fixtureProfile: plan.fixture }),
            outputPaths: () => ({}),
            testOptions: () => ({}),
          }
        throw new Error(`Unexpected Playwright configuration import: ${name}`)
      },
    },
    { filename }
  )
  return exports.default
}

test('actual Playwright fixture configurations select exactly their declared profile files', () => {
  for (const plan of Object.values(productAdminE2ePlans)) {
    const config = profileConfig(plan)
    const patterns = (value) => (value ? (Array.isArray(value) ? value : [value]) : [])
    const matches = patterns(config.testMatch)
    const ignores = patterns(config.testIgnore)
    const files = readdirSync(`apps/web/${config.testDir}`).filter(
      (file) =>
        file.endsWith('.spec.ts') &&
        (!matches.length || matches.some((pattern) => matchesGlob(file, pattern))) &&
        !ignores.some((pattern) => matchesGlob(file, pattern))
    )
    assert.deepEqual(files.sort(), [...plan.files].sort(), plan.fixture)
  }
})

const sharedSpecs = new Map()
sharedSpecs.set('console-support-mail.spec.ts', ['support-mail-host', 'support-mail-path'])

test('required staff CI plans cover every spec with only declared cross-profile reuse', () => {
  const owners = new Map()
  for (const [name, plan] of Object.entries(productAdminE2ePlans)) {
    if (plan.lane !== 'product-admin-real-stack') continue
    for (const file of plan.files) owners.set(file, [...(owners.get(file) ?? []), name])
  }
  assert.deepEqual(
    [...owners.keys()].sort(),
    readdirSync('apps/web/e2e/product-admin-real-stack')
      .filter((file) => file.endsWith('.spec.ts'))
      .sort()
  )
  for (const [file, expected] of sharedSpecs)
    assert.deepEqual(owners.get(file)?.sort(), expected, file)
  for (const [file, profiles] of owners) {
    if (!sharedSpecs.has(file)) assert.equal(profiles.length, 1, file)
  }
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
