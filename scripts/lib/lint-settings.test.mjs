import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { nativeConfig } from '../../packages/eslint-config/hybrid.js'

const ROOT = path.resolve(import.meta.dirname, '../..')

test('native accessibility settings reach real CLI; conflicting settings fail', () => {
  const policy = [
    {
      files: ['**/*.tsx'],
      settings: { 'jsx-a11y': { components: { Image: 'img' }, polymorphicPropName: 'as' } },
      rules: { 'jsx-a11y/alt-text': 'error' },
    },
  ]
  const dir = realpathSync(mkdtempSync(path.join(ROOT, '.lint-consumer-')))
  try {
    writeFileSync(path.join(dir, 'native.json'), JSON.stringify(nativeConfig(policy, dir)))
    for (const [jsx, expected] of [
      ['<Image />', true],
      ['<Image alt="" />', false],
      ['<Box as="img" />', true],
      ['<Box as="img" alt="" />', false],
    ]) {
      writeFileSync(path.join(dir, 'case.tsx'), `export const Fixture = () => ${jsx}`)
      const run = spawnSync(
        path.join(ROOT, 'node_modules/.bin/oxlint'),
        ['-c', 'native.json', '--format=json', 'case.tsx'],
        { cwd: dir, encoding: 'utf8' }
      )
      assert.equal(run.status, expected ? 1 : 0, run.stderr)
      const result = JSON.parse(run.stdout)
      assert.equal(result.number_of_files, 1)
      assert.equal(
        result.diagnostics.some((item) => item.code === 'jsx-a11y(alt-text)'),
        expected
      )
    }
    const conflicting = [...policy, { settings: { 'jsx-a11y': { components: { Image: 'div' } } } }]
    assert.throws(() => nativeConfig(conflicting, dir), /conflicting scoped/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
