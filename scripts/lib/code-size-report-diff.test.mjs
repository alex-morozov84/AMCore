import assert from 'node:assert/strict'
import test from 'node:test'

import { fixture } from './code-size-test-support.mjs'

test('only changed legacy file is reported', () => {
  const repo = fixture()
  try {
    const old = `${Array(160).fill('// old debt').join('\n')}\n`
    repo.write('changed.ts', old)
    repo.write('untouched.ts', old)
    repo.git('commit', '-qm', 'baseline')
    repo.write('changed.ts', old.replace('// old debt', '// changed'))
    const result = repo.run()
    assert.equal(result.status, 0)
    assert.match(result.stdout, /changed\.ts: 160 lines \[review size\]/)
    assert.doesNotMatch(result.stdout, /untouched\.ts/)
  } finally {
    repo.close()
  }
})

test('deletion-only edit selects the containing function', () => {
  const repo = fixture()
  try {
    repo.write('helper.ts', 'function helper() {\n  const a = 1\n  const b = 2\n}\n')
    repo.git('commit', '-qm', 'baseline')
    repo.write('helper.ts', 'function helper() {\n  const a = 1\n}\n')
    const result = repo.run()
    assert.equal(result.status, 0)
    assert.match(result.stdout, /helper @ 1: 3 lines/)
  } finally {
    repo.close()
  }
})

test('changed long function is shown without a baseline comparison', () => {
  const repo = fixture()
  try {
    const original = ['function helper() {', ...Array(28).fill('  void 0'), '}'].join('\n')
    repo.write('helper.ts', `${original}\n`)
    repo.git('commit', '-qm', 'baseline')
    repo.write('helper.ts', `${original.replace('void 0', 'void 1')}\n`)
    const result = repo.run()
    assert.equal(result.status, 0)
    assert.match(result.stdout, /helper @ 1: 30 lines \[review size\]/)
  } finally {
    repo.close()
  }
})

test('pure rename and untouched debt are silent', () => {
  const repo = fixture()
  try {
    repo.write('old.ts', `${Array(160).fill('// old debt').join('\n')}\n`)
    repo.git('commit', '-qm', 'baseline')
    repo.git('mv', 'old.ts', 'new.ts')
    const result = repo.run()
    assert.equal(result.status, 0)
    assert.match(result.stdout, /no staged code files/)
  } finally {
    repo.close()
  }
})

test('parse failure is visible without blocking', () => {
  const repo = fixture()
  try {
    repo.write('broken.ts', 'function {\n')
    const result = repo.run()
    assert.equal(result.status, 0)
    assert.match(result.stderr, /size report unavailable: .*parser/)
  } finally {
    repo.close()
  }
})
