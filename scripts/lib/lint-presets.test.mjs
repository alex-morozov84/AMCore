import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { nativeConfig } from '../../packages/eslint-config/hybrid.js'

const ROOT = path.resolve(import.meta.dirname, '../..')

for (const preset of ['base', 'nest', 'next']) {
  test(`exported ${preset}: paired real CLI consumer`, async () => {
    const dir = realpathSync(mkdtempSync(path.join(ROOT, '.lint-consumer-')))
    try {
      const url = pathToFileURL(path.join(ROOT, `packages/eslint-config/${preset}.js`)).href
      const { policy } = await import(url)
      const config = path.join(dir, 'eslint.config.mjs')
      writeFileSync(config, `export {default} from ${JSON.stringify(url)}`)
      writeFileSync(
        path.join(dir, 'native.json'),
        JSON.stringify(nativeConfig(policy, path.join(ROOT, 'apps/web')))
      )
      for (const [code, expected] of [
        ['export const value = 1', 0],
        ['export const value: any = 1', 1],
      ]) {
        writeFileSync(path.join(dir, 'case.ts'), code)
        const native = spawnSync(
          path.join(ROOT, 'node_modules/.bin/oxlint'),
          ['-c', 'native.json', '--format=json', '--max-warnings=0', 'case.ts'],
          { cwd: dir, encoding: 'utf8' }
        )
        assert.equal(native.status, expected, native.stderr)
        const output = JSON.parse(native.stdout)
        assert.equal(output.number_of_files, 1)
        assert.equal(
          output.diagnostics.some((item) => item.code === 'typescript(no-explicit-any)'),
          Boolean(expected)
        )
        const residual = spawnSync(
          path.join(ROOT, 'node_modules/.bin/eslint'),
          ['--no-config-lookup', '--config', config, '--format=json', 'case.ts'],
          { cwd: dir, encoding: 'utf8' }
        )
        assert.equal(residual.status, 0, residual.stdout + residual.stderr)
        const files = JSON.parse(residual.stdout)
        assert.equal(files.length, 1)
        assert.equal(files[0].warningCount, 0)
        assert.equal(files[0].errorCount, 0)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
