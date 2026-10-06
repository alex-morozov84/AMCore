import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { selectedFiles, specFiles } from '../e2e-ci-plan.mjs'
import { run } from './process.mjs'

const flatten = (suites) =>
  suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({
        id: `${spec.id}:${test.projectName}`,
        file: `e2e/real-stack/${spec.file}`,
        title: spec.title,
      }))
    ),
    ...flatten(suite.suites ?? []),
  ])

async function collect(options, args = []) {
  const report = JSON.parse(
    await run(
      'pnpm',
      [
        '--filter',
        'web',
        'exec',
        'playwright',
        'test',
        '--config=playwright.real-stack.config.ts',
        ...args,
        '--list',
        '--reporter=json',
      ],
      { ...options, capture: true }
    )
  )
  assert.equal(report.errors?.length ?? 0, 0, 'Playwright inventory collection failed')
  return flatten(report.suites)
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
