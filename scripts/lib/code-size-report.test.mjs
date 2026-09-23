import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { fixture } from './code-size-test-support.mjs'

const longHelper = ['function helper() {', ...Array(28).fill('  void 0'), '}'].join('\n')

test('new long test file is advisory and sub-threshold items remain visible', () => {
  const repo = fixture()
  try {
    repo.write(
      'sample.test.ts',
      `${Array(147).fill('// fixture').join('\n')}\nfunction small() {}\n`
    )
    const result = repo.run()
    assert.equal(result.status, 0)
    assert.match(result.stdout, /sample\.test\.ts: 148 lines/)
    assert.match(result.stdout, /small @ 148: 1 lines/)
    repo.write(
      'sample.test.ts',
      `${Array(149).fill('// fixture').join('\n')}\nfunction small() {}\n`
    )
    const long = repo.run()
    assert.equal(long.status, 0)
    assert.match(long.stdout, /sample\.test\.ts: 150 lines \[review size\]/)
  } finally {
    repo.close()
  }
})

test('test wrappers are omitted but nested helpers are reported', () => {
  const repo = fixture()
  try {
    for (const call of [
      'describe',
      'test.only',
      'it.skip',
      'test.concurrent',
      'describe.each([1])',
    ]) {
      repo.write('helper.test.ts', `${call}('suite', () => {\n${longHelper}\n})\n`)
      const result = repo.run()
      assert.equal(result.status, 0)
      assert.match(result.stdout, /helper @ 2: 30 lines \[review size\]/)
      assert.doesNotMatch(result.stdout, /<callback>/)
    }
  } finally {
    repo.close()
  }
})

test('ordinary changed function is reported without blocking', () => {
  const repo = fixture()
  try {
    repo.write('helper.ts', `${longHelper}\n`)
    const result = repo.run()
    assert.equal(result.status, 0)
    assert.match(result.stdout, /helper @ 1: 30 lines \[review size\]/)
  } finally {
    repo.close()
  }
})

test('hook keeps lint failures blocking and runs reporter afterwards', () => {
  const hook = readFileSync(
    fileURLToPath(new URL('../../.husky/pre-commit', import.meta.url)),
    'utf8'
  )
  assert.match(hook, /CI=true pnpm lint-staged \|\| exit \$\?/)
  assert.ok(hook.indexOf('lint-staged') < hook.indexOf('code-size-report.mjs'))
})
