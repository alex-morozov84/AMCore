import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Stand-ins for the commands the script calls; the daemon config is a temp file.
const hasMirror = 'grep -q mirror.gcr.io "$DOCKER_DAEMON_CONFIG" 2>/dev/null'
const shims = {
  sudo: 'exec "$@"',
  timeout: 'shift; exec "$@"',
  sleep: 'exit 0',
  systemctl: `echo restart >> "$FAKE_LOG"; [ "\${FAKE_RESTART_FAIL:-}" = 1 ] && ${hasMirror} && exit 1; exit 0`,
  docker: `[ "\${FAKE_DOCKER_DEAD:-}" = 1 ] && exit 1; ${hasMirror} && echo '[https://mirror.gcr.io/]' || echo '[]'`,
}

function run({ config, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'mirror-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  for (const [name, body] of Object.entries(shims)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  const file = join(dir, 'daemon.json')
  if (config !== undefined) writeFileSync(file, config)
  const log = join(dir, 'calls.log')
  writeFileSync(log, '')
  const result = spawnSync('bash', ['scripts/docker-registry-mirror.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DOCKER_DAEMON_CONFIG: file,
      FAKE_LOG: log,
      DOCKER_READY_ATTEMPTS: '3',
      ...env,
    },
  })
  const config_ = existsSync(file) ? readFileSync(file, 'utf8') : null
  rmSync(dir, { recursive: true, force: true })
  return { status: result.status, output: result.stdout, config: config_ }
}

test('the mirror is added and other daemon settings are kept', () => {
  const r = run({ config: '{"log-level":"warn","registry-mirrors":["https://old.example"]}' })
  assert.equal(r.status, 0)
  assert.deepEqual(JSON.parse(r.config), {
    'log-level': 'warn',
    'registry-mirrors': ['https://mirror.gcr.io'],
  })
  assert.match(r.output, /mirror: active/)
})

test('a failed restart restores the original config and keeps the job going with a warning', () => {
  const original = '{"log-level":"warn"}'
  const r = run({ config: original, env: { FAKE_RESTART_FAIL: '1' } })
  assert.equal(r.status, 0)
  assert.equal(r.config.trim(), original)
  assert.match(r.output, /::warning title=Docker Hub mirror::/)
})

test('an invalid config is left untouched', () => {
  const r = run({ config: '{not json' })
  assert.equal(r.status, 0)
  assert.equal(r.config, '{not json')
})

test('the script fails only when Docker itself does not come back', () => {
  const r = run({ config: '{}', env: { FAKE_DOCKER_DEAD: '1' } })
  assert.equal(r.status, 1)
  assert.match(r.output, /::error title=Docker Hub mirror::/)
})
