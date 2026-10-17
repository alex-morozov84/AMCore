import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createWorkingTreeCopy } from './working-tree-fixture.mjs'

import nativeRules from '../../packages/eslint-config/native-rules.json' with { type: 'json' }

const ROOT = path.resolve(import.meta.dirname, '../..')
const originalRules = Object.fromEntries(
  Object.entries(nativeRules).map(([id, native]) => [native, id])
)

function messages(engine) {
  if (engine.engine === 'eslint') {
    return JSON.parse(engine.stdout).flatMap((file) => file.messages)
  }
  const output = JSON.parse(engine.stdout)
  if (output.number_of_files !== 1) throw new Error('Native fixture was not checked')
  return output.diagnostics.map(({ code, message, help }) => {
    const match = /^([^()]+)\((.+)\)$/.exec(code)
    if (!match) throw new Error(`Unknown native diagnostic: ${code}`)
    const id = match[1] === 'eslint' ? match[2] : `${match[1]}/${match[2]}`
    return { ruleId: originalRules[id] ?? id, message: [message, help].filter(Boolean).join(' ') }
  })
}

function lintFixture(root, code, filePath) {
  const webRoot = path.join(root, 'apps/web')
  const relative = path.join(
    path.dirname(filePath),
    `lint-${randomUUID()}-${path.basename(filePath)}`
  )
  const file = path.join(webRoot, relative)
  if (existsSync(file)) throw new Error(`Refuse existing fixture: ${file}`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, code)
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/lint.mjs'), '--scope', 'web', '--format=json', relative],
      { cwd: webRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
    )
    if (result.error || result.signal || ![0, 1].includes(result.status ?? -1)) {
      throw result.error ?? new Error(result.stderr || 'Lint fixture failed to execute')
    }
    const output = JSON.parse(result.stdout)
    return output.engines.flatMap(messages)
  } finally {
    unlinkSync(file)
  }
}

// Keep probes outside the checkout: parallel source guards enumerate real source.
// One copy per test file preserves path-sensitive policy without copying per case.
export function createLintFixture() {
  const fixture = createWorkingTreeCopy(ROOT)
  try {
    for (const directory of ['', 'apps/web']) {
      symlinkSync(
        path.join(ROOT, directory, 'node_modules'),
        path.join(fixture.root, directory, 'node_modules')
      )
    }
    return {
      root: fixture.root,
      lint: (code, filePath) => lintFixture(fixture.root, code, filePath),
      cleanup: fixture.cleanup,
    }
  } catch (error) {
    fixture.cleanup()
    throw error
  }
}
