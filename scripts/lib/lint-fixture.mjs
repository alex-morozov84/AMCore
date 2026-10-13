import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import nativeRules from '../../packages/eslint-config/native-rules.json' with { type: 'json' }

const ROOT = path.resolve(import.meta.dirname, '../..')
const WEB_ROOT = path.join(ROOT, 'apps/web')
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

export function lintFixture(code, filePath) {
  const relative = path.join(
    path.dirname(filePath),
    `lint-${randomUUID()}-${path.basename(filePath)}`
  )
  const file = path.join(WEB_ROOT, relative)
  if (existsSync(file)) throw new Error(`Refuse existing fixture: ${file}`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, code)
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts/lint.mjs'), '--scope', 'web', '--format=json', relative],
      { cwd: WEB_ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
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
