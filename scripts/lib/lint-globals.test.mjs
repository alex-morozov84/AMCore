import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { nativeConfig } from '../../packages/eslint-config/hybrid.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const scopes = [
  ['root', '.', 'scripts', 'mjs', 'eslint.config.js'],
  ['web', 'apps/web', 'e2e/support', 'mjs', 'eslint.config.mjs'],
  ['config', 'packages/eslint-config', '.', 'js', 'eslint.config.mjs'],
]

for (const [scope, directory, folder, extension, filename] of scopes) {
  test(`${scope}: native globals retain paths, exclusions, order and binding semantics`, async () => {
    const cwd = path.join(ROOT, directory)
    const { policy } = await import(pathToFileURL(path.join(cwd, filename)).href)
    const config = path.join(cwd, `.oxlint-run-${randomUUID()}.json`)
    const file = path.posix.join(folder, `lint-globals-proof-${randomUUID()}.${extension}`)
    const sources = new Set()
    const run = (code, extra = [], selected = file) => {
      const source = path.join(cwd, selected)
      sources.add(source)
      writeFileSync(source, code)
      writeFileSync(config, JSON.stringify(nativeConfig([...policy, ...extra], cwd)))
      const result = spawnSync(
        path.join(ROOT, 'node_modules/.bin/oxlint'),
        ['-c', config, '--format=json', selected],
        { cwd, encoding: 'utf8' }
      )
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null)
      const output = JSON.parse(result.stdout)
      assert.equal(output.number_of_files, 1)
      assert.ok(
        output.diagnostics.every((item) => item.code === 'eslint(no-global-assign)'),
        JSON.stringify(output.diagnostics)
      )
      assert.equal(result.status, output.diagnostics.length ? 1 : 0, result.stderr)
      return output.diagnostics.some((item) => item.code === 'eslint(no-global-assign)')
    }
    const scoped = (value, ignores) => ({
      files: [file],
      ...(ignores && { ignores }),
      languageOptions: { globals: { process: value } },
    })
    try {
      const globals = policy.filter((block) => block.languageOptions?.globals)
      const emitted = nativeConfig(policy, cwd).overrides.filter((block) => block.globals)
      assert.equal(emitted.length, globals.length)
      globals.forEach((block, index) => {
        assert.deepEqual(emitted[index].globals, block.languageOptions.globals)
        assert.deepEqual(
          emitted[index].files,
          block.files ?? ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}']
        )
        assert.deepEqual(emitted[index].excludeFiles, block.ignores)
      })
      assert.equal(run('process = {}'), true)
      assert.equal(run('export const value = process'), false)
      assert.equal(run('const process = 1; export const value = process'), false)
      assert.equal(run('process = {}', [scoped('writable')]), false)
      assert.equal(run('process = {}', [scoped('off')]), false)
      assert.equal(run('process = {}', [scoped('writable'), scoped('readonly')]), true)
      assert.equal(run('process = {}', [scoped('writable', [file])]), true)
      assert.equal(run('process = {}', [], file.replace(/\.[^.]+$/, '.cjs')), false)
      if (scope === 'config')
        assert.equal(run('process = {}', [], file.replace(/\.js$/, '.mjs')), true)
      else
        assert.equal(
          run(
            'process = {}',
            [],
            path.posix.join(path.posix.dirname(folder), path.posix.basename(file))
          ),
          false
        )
    } finally {
      for (const source of sources) rmSync(source, { force: true })
      rmSync(config, { force: true })
    }
  })
}
