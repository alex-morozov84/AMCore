import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from 'yaml'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { supervisedProbe } from '../runner-disk-admission.mjs'

const script = resolve('scripts/free-runner-disk.sh')

test('whole probe deadline terminates child group and malformed responses retain cleanup', async () => {
  assert.deepEqual(await supervisedProbe(['-e', 'console.log(JSON.stringify({skip:true}))']), {
    skip: true,
  })
  assert.deepEqual(await supervisedProbe(['-e', 'console.log("null")']), {
    skip: false,
    reason: 'invalid-probe-output',
  })
  assert.deepEqual(await supervisedProbe(['-e', 'console.log("x".repeat(20000))']), {
    skip: false,
    reason: 'probe-output-limit',
  })
  const result = await supervisedProbe(
    [
      '-e',
      `
    const {spawn}=require('node:child_process');
    spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:['ignore',1,2]});
    setInterval(()=>{},100);
  `,
    ],
    150
  )
  assert.deepEqual(result, { skip: false, reason: 'probe-timeout' })
  const interrupted = supervisedProbe(['-e', 'setInterval(()=>{},100)'])
  process.emit('SIGTERM')
  assert.deepEqual(await interrupted, { skip: false, reason: 'probe-cancelled' })
  assert.deepEqual(await supervisedProbe(['-e', 'console.log("invalid")']), {
    skip: false,
    reason: 'invalid-probe-output',
  })
  assert.deepEqual(await supervisedProbe(['-e', 'process.exit(3)']), {
    skip: false,
    reason: 'probe-error',
  })
})

test('shell preserves no-option deletion, conditional fallback and original failures without real SDK deletion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-disk-'))
  const log = join(directory, 'calls')
  const bootstrap = join(directory, 'commands.bash')
  writeFileSync(
    bootstrap,
    `
    df() { return "\${DF_EXIT:-0}"; }
    node() { echo "node $*" >> "$CALL_LOG"; return "$PROBE_EXIT"; }
    sudo() { echo "$*" >> "$CALL_LOG"; return "\${DELETE_EXIT:-0}"; }
  `
  )
  const run = (args, change = {}) => {
    writeFileSync(log, '')
    const options = {
      env: {
        ...process.env,
        PATH: '/usr/bin:/bin',
        BASH_ENV: bootstrap,
        CALL_LOG: log,
        GITHUB_WORKSPACE: directory,
        RUNNER_TEMP: directory,
        PROBE_EXIT: '1',
        ...change,
      },
      encoding: 'utf8',
      timeout: 2000,
    }
    const result =
      typeof args === 'string'
        ? spawnSync('bash', ['-c', args], options)
        : spawnSync('bash', [script, ...args], options)
    return { status: result.status, calls: readFileSync(log, 'utf8') }
  }
  try {
    const legacy = run([])
    assert.equal(legacy.status, 0)
    assert.equal(legacy.calls, 'rm -rf -- /usr/local/lib/android /usr/share/dotnet\n')
    assert.match(run(['--lane', 'path-standard']).calls, /rm -rf --/)
    assert.doesNotMatch(run(['--lane', 'path-standard'], { PROBE_EXIT: '0' }).calls, /rm -rf/)
    assert.equal(run(['--lane', 'path-disruptive'], { PROBE_EXIT: '0' }).status, 0)
    assert.equal(run(['--lane', 'safety'], { DELETE_EXIT: '7' }).status, 7)
    assert.equal(run([], { DF_EXIT: '8' }).status, 8)
    assert.equal(run(['--lane', 'path-standard'], { PROBE_EXIT: '1', DELETE_EXIT: '9' }).status, 9)
    const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
    const step = workflow.jobs['web-e2e-lanes'].steps.find(
      (item) => item.name === 'Free unused SDK disk space for Docker lanes'
    )
    assert.equal(step.if, "matrix.lane != 'mocked'")
    for (const lane of ['path-standard', 'path-disruptive', 'safety', 'host']) {
      const called = run(step.run, { E2E_CI_LANE: lane, PROBE_EXIT: '0' })
      assert.equal(called.status, 0)
      assert.equal(called.calls.includes('node '), lane.startsWith('path-'))
      assert.equal(called.calls.includes('rm -rf'), !lane.startsWith('path-'))
    }
    for (const name of ['docker-image-smoke', 'observability-contract-live'])
      assert.ok(
        workflow.jobs[name].steps.some((item) => item.run === 'bash scripts/free-runner-disk.sh')
      )
    execFileSync('bash', ['-n', script])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
