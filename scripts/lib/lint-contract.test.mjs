import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { nativeRule } from '../../packages/eslint-config/hybrid.js'

const ROOT = path.resolve(import.meta.dirname, '../..')

function nativeID(code) {
  const match = /^([^()]+)\((.+)\)$/.exec(code)
  assert.ok(match, `Unexpected native rule ID: ${code}`)
  return match[1] === 'eslint' ? match[2] : `${match[1]}/${match[2]}`
}

function run(scope, cases, options = []) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts/lint.mjs'),
      '--scope',
      scope,
      '--format=json',
      ...options,
      ...cases.map((item) => item.file),
    ],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  )
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.ok(result.stdout.trim(), result.stderr)
  return { result, engines: JSON.parse(result.stdout).engines }
}

function provesTarget(engines, item) {
  return engines.some((engine) => {
    const output = JSON.parse(engine.stdout)
    if (engine.engine === 'oxlint') {
      return output.diagnostics.some(
        (diagnostic) =>
          diagnostic.filename === item.file && nativeID(diagnostic.code) === nativeRule(item.rule)
      )
    }
    return output.some(
      (file) =>
        file.filePath.endsWith(`/${item.file}`) &&
        file.messages.some((message) => message.ruleId === item.rule)
    )
  })
}

for (const scope of ['api', 'web']) {
  test(`${scope} policy: real CLI allowed and prohibited cases`, () => {
    const cwd = path.join(ROOT, 'apps', scope)
    const cases = JSON.parse(
      readFileSync(new URL(`../fixtures/lint/${scope}.json`, import.meta.url))
    ).map((item, index) => ({
      ...item,
      file: path.join(
        path.dirname(item.file),
        `lint-contract-${index}-${path.basename(item.file)}`
      ),
    }))
    const created = []
    try {
      for (const item of cases) {
        const file = path.join(cwd, item.file)
        assert.equal(existsSync(file), false, `Refuse existing fixture: ${file}`)
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, `${item.code}\n`)
        created.push(file)
      }
      const { result, engines } = run(scope, cases)
      assert.equal(result.status, 1, 'Prohibited corpus must fail the actual wrapper')
      assert.equal(JSON.parse(engines[0].stdout).number_of_files, cases.length)
      assert.equal(JSON.parse(engines[1].stdout).length, cases.length)
      for (const item of cases) {
        assert.equal(provesTarget(engines, item), item.expected, `${item.name}: ${item.rule}`)
      }
    } finally {
      created.forEach((file) => unlinkSync(file))
    }
  })
}
