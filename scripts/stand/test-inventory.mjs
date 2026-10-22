import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { selectedFiles, specFiles } from '../e2e-ci-plan.mjs'
import { productAdminE2ePlans } from '../product-admin-e2e-plan.mjs'
import { run } from './process.mjs'

const flatten = (suites, directory = 'real-stack') =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({
        id: `${spec.id}:${test.projectName}`,
        file: `e2e/${directory}/${spec.file}`,
        title: spec.title,
      }))
    ),
    ...flatten(suite.suites ?? [], directory),
  ])

async function collect(options, args = [], lane = 'real-stack') {
  const report = JSON.parse(
    await run(
      'pnpm',
      [
        '--filter',
        'web',
        'exec',
        'playwright',
        'test',
        `--config=playwright.${lane}.config.ts`,
        ...args,
        '--list',
        '--reporter=json',
      ],
      { ...options, capture: true }
    )
  )
  assert.equal(report.errors?.length ?? 0, 0, 'Playwright inventory collection failed')
  return flatten(report.suites, lane)
}

export async function groupArguments(m, group, options) {
  const tests = await collect(options)
  assert.equal(new Set(tests.map((test) => test.id)).size, tests.length, 'Duplicate test IDs')
  assert.deepEqual([...new Set(tests.map((test) => test.file))].sort(), specFiles(m.snapshot))
  const files = selectedFiles(m.snapshot, group)
  assert.ok(files.length, 'Empty E2E group refused')
  const args = files.map((file) => RegExp.escape(file) + '$')
  const expected = tests.filter((test) => files.includes(test.file))
  assert.ok(expected.length, 'No tests selected')
  assert.deepEqual(await collect(options, args), expected, 'E2E selection lost or duplicated tests')
  await writeFile(
    `${m.worktree}/.amcore/stands/${m.id}/inventory.json`,
    JSON.stringify(
      {
        group,
        full: tests,
        selected: expected,
      },
      null,
      2
    )
  )
  console.log(
    `E2E inventory: ${group} selects ${expected.length}/${tests.length} tests in ${files.length} files`
  )
  return args
}

export function assertProfileInventory(tests, plan) {
  assert.ok(tests.length, 'Empty staff profile inventory refused')
  assert.equal(new Set(tests.map((test) => test.id)).size, tests.length, 'Duplicate staff test IDs')
  const directory = `e2e/${plan.lane}`
  assert.deepEqual(
    [...new Set(tests.map((test) => test.file))].sort(),
    plan.files.map((file) => `${directory}/${file}`).sort(),
    'Staff profile lost or added a spec'
  )
}

export async function profileInventory(m, lane, options, args) {
  const plan = Object.values(productAdminE2ePlans).find((plan) => plan.fixture === m.fixtureProfile)
  if (!plan) return
  const full = await collect(options, [], lane)
  assertProfileInventory(full, plan)
  const selected = args.length ? await collect(options, args, lane) : full
  assert.ok(selected.length, 'Empty selected staff inventory refused')
  if (options.env.CI === 'true')
    assert.deepEqual(selected, full, 'CI staff profile selection omitted tests')
  await writeFile(
    `${m.worktree}/.amcore/stands/${m.id}/inventory.json`,
    JSON.stringify({ profile: m.fixtureProfile, full, selected }, null, 2)
  )
  console.log(
    `Staff inventory: ${selected.length}/${full.length} tests in ${plan.files.length} files`
  )
}
