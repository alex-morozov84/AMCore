import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function executableSource() {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.AMCORE_VERIFY_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\\n')
if (JSON.stringify(args) === process.env.AMCORE_VERIFY_FAIL) {
  console.error('injected pnpm failure')
  process.exitCode = 17
}
`
}

function readCalls(log) {
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export function createRecordingPnpm() {
  const bin = mkdtempSync(path.join(tmpdir(), 'amcore-fake-pnpm-'))
  const log = path.join(bin, 'calls.jsonl')
  writeFileSync(path.join(bin, 'pnpm'), executableSource(), { mode: 0o755 })
  const environment = (failCommand) => ({
    ...process.env,
    AMCORE_VERIFY_LOG: log,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    ...(failCommand ? { AMCORE_VERIFY_FAIL: JSON.stringify(failCommand) } : {}),
  })
  return Object.freeze({
    environment,
    readCalls: () => readCalls(log),
    cleanup: () => rmSync(bin, { recursive: true, force: true }),
  })
}

export function withRecordingPnpm(failCommand, run) {
  const recording = createRecordingPnpm()
  const next = recording.environment(failCommand)
  const keys = ['AMCORE_VERIFY_FAIL', 'AMCORE_VERIFY_LOG', 'PATH']
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) {
    if (next[key] === undefined) delete process.env[key]
    else process.env[key] = next[key]
  }
  try {
    return run(recording)
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    recording.cleanup()
  }
}
